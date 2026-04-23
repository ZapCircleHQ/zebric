import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { seedBenchmark } from '../seed/seedRunner.mjs'
import { BenchmarkMetrics, summarizeMetrics } from './metricsCollector.mjs'
import { createRampController } from './rampController.mjs'
import { createInteractiveUserScenario } from '../scenarios/interactiveUser.mjs'
import { createWebhookProducer } from '../scenarios/webhookProducer.mjs'
import { createWorkflowPoller } from '../scenarios/workflowPoller.mjs'
import { createNotificationPoller } from '../scenarios/notificationPoller.mjs'
import {
  defaultResultsDir,
  ensureDir,
  openBenchmarkDatabase,
  parseDatabaseUrl,
  sleep,
  startLocalApp,
} from '../lib/runtime.mjs'
import { writeBenchmarkReport, printBenchmarkSummary } from './reportWriter.mjs'
import profileBigZebra from '../profiles/big-zebra-v1.mjs'
import profileBrowsingHerd from '../profiles/browsing-herd.mjs'
import profileWebhookStorm from '../profiles/webhook-storm.mjs'
import { startNotificationSink } from '../simulators/notification-sink.mjs'

const PROFILES = {
  'big-zebra-v1': profileBigZebra,
  'browsing-herd': profileBrowsingHerd,
  'webhook-storm': profileWebhookStorm,
}

async function loadCatalog(connection) {
  const sqlite = connection.getSQLite()
  if (sqlite) {
    return {
      teamIds: sqlite.prepare('SELECT id FROM team LIMIT 500').all().map((row) => row.id),
      userIds: sqlite.prepare('SELECT id FROM user LIMIT 5000').all().map((row) => row.id),
      requestIds: sqlite.prepare('SELECT id FROM request LIMIT 20000').all().map((row) => row.id),
      approvalIds: sqlite.prepare("SELECT id FROM approval_step WHERE status = 'pending' LIMIT 5000").all().map((row) => row.id),
    }
  }

  const postgres = connection.getPostgres()
  const [teamIds, userIds, requestIds, approvalIds] = await Promise.all([
    postgres.unsafe('SELECT id FROM team LIMIT 500'),
    postgres.unsafe('SELECT id FROM "user" LIMIT 5000'),
    postgres.unsafe('SELECT id FROM request LIMIT 20000'),
    postgres.unsafe("SELECT id FROM approval_step WHERE status = 'pending' LIMIT 5000"),
  ])

  return {
    teamIds: teamIds.map((row) => row.id),
    userIds: userIds.map((row) => row.id),
    requestIds: requestIds.map((row) => row.id),
    approvalIds: approvalIds.map((row) => row.id),
  }
}

async function sampleBacklog(connection) {
  const sqlite = connection.getSQLite()
  if (sqlite) {
    return {
      pendingWorkflowCount: sqlite.prepare("SELECT COUNT(*) AS count FROM workflow_run WHERE status = 'pending'").get().count,
      pendingNotificationCount: sqlite.prepare("SELECT COUNT(*) AS count FROM notification WHERE status = 'pending'").get().count,
      webhookBacklogCount: sqlite.prepare("SELECT COUNT(*) AS count FROM webhook_event WHERE processing_status = 'pending'").get().count,
    }
  }

  const postgres = connection.getPostgres()
  const [workflow, notification, webhook] = await Promise.all([
    postgres.unsafe("SELECT COUNT(*)::int AS count FROM workflow_run WHERE status = 'pending'"),
    postgres.unsafe("SELECT COUNT(*)::int AS count FROM notification WHERE status = 'pending'"),
    postgres.unsafe("SELECT COUNT(*)::int AS count FROM webhook_event WHERE processing_status = 'pending'"),
  ])
  return {
    pendingWorkflowCount: workflow[0].count,
    pendingNotificationCount: notification[0].count,
    webhookBacklogCount: webhook[0].count,
  }
}

function buildVerdict(summary, profile, durationSeconds) {
  const readP95s = ['listRequests', 'openRequestDetail', 'readDashboard']
    .map((name) => summary.operations[name]?.p95 ?? 0)
  const writeP95s = ['createRequest', 'addComment', 'assignRequest', 'changeStatus', 'completeApproval']
    .map((name) => summary.operations[name]?.p95 ?? 0)

  const notes = []
  let verdict = 'pass'

  if (summary.errorRate > profile.thresholds.maxErrorRate) {
    verdict = 'fail'
    notes.push('error rate exceeded threshold')
  }
  if (Math.max(...readP95s, 0) > profile.thresholds.maxReadP95Ms) {
    verdict = verdict === 'fail' ? 'fail' : 'degraded'
    notes.push('read latency exceeded threshold')
  }
  if (Math.max(...writeP95s, 0) > profile.thresholds.maxWriteP95Ms) {
    verdict = verdict === 'fail' ? 'fail' : 'degraded'
    notes.push('write latency exceeded threshold')
  }
  if (summary.backlog.webhookBacklogCount > 0 && durationSeconds > profile.thresholds.maxWebhookDrainSeconds) {
    verdict = verdict === 'fail' ? 'fail' : 'degraded'
    notes.push('webhook backlog remained non-zero at end of run')
  }
  if (summary.system.peakEventLoopLagMs > 250) {
    verdict = verdict === 'fail' ? 'fail' : 'degraded'
    notes.push('event loop lag spiked above 250ms')
  }

  return { verdict, notes }
}

export async function runBenchmark(options = {}) {
  const profile = PROFILES[options.profile ?? 'big-zebra-v1']
  if (!profile) {
    throw new Error(`Unknown profile: ${options.profile}`)
  }

  const topology = options.topology ?? 'local'
  const durationSeconds = Number(options.duration ?? profile.durationSeconds)
  const concurrency = Number(options.concurrency ?? profile.concurrency)
  const databaseUrl = options.databaseUrl
    ?? process.env.DATABASE_URL
    ?? `sqlite://${resolve('benchmark/data/big-zebra.db')}`
  const sinkUrl = options.sinkUrl ?? process.env.NOTIFICATION_SINK_URL ?? 'http://127.0.0.1:3210'
  const mode = options.mode ?? 'app-worker'
  const runId = randomUUID()

  if (!options.noSeed) {
    await seedBenchmark({
      profile: profile.name,
      tier: options.seedTier ?? 'smoke',
      seedValue: Number(options.seedValue ?? 1337),
      databaseUrl,
      outputSummary: false,
      reset: true,
    })
  }

  let localApp
  let localSink

  if (topology === 'local') {
    localSink = await startNotificationSink({
      host: '127.0.0.1',
      port: Number(new URL(sinkUrl).port || 3210),
      mode: options.notificationMode ?? 'normal',
    })
    localApp = await startLocalApp({
      port: Number(options.port ?? 3200),
      host: '127.0.0.1',
      databaseUrl,
    })
  }

  const baseUrl = options.baseUrl
    ?? process.env.BENCHMARK_BASE_URL
    ?? (topology === 'local' ? localApp.getUrl() : 'http://nginx:8080')
  const metrics = new BenchmarkMetrics()
  const ramp = createRampController(profile, concurrency)
  const { connection } = await openBenchmarkDatabase(databaseUrl)
  const catalog = await loadCatalog(connection)
  const backlogBaseline = await sampleBacklog(connection)
  const csrfBootstrap = await fetch(`${baseUrl}/`)
  const setCookie = csrfBootstrap.headers.get('set-cookie') ?? ''
  const csrfToken = /csrf-token=([^;]+)/.exec(setCookie)?.[1]
  const requestHeaders = csrfToken
    ? {
        cookie: `csrf-token=${csrfToken}`,
        'x-csrf-token': decodeURIComponent(csrfToken),
      }
    : {}

  let running = true
  const isRunning = () => running
  const startedAt = Date.now()
  const getDesiredConcurrency = () => ramp.getConcurrency((Date.now() - startedAt) / 1000)

  const scenarioContext = {
    profile,
    baseUrl,
    catalog,
    metrics,
    runId,
    requestHeaders,
  }

  const interactiveScenario = createInteractiveUserScenario(scenarioContext)
  const webhookProducer = createWebhookProducer(scenarioContext)
  const workflowPoller = createWorkflowPoller({ connection, metrics })
  const notificationPoller = createNotificationPoller({ connection, metrics, sinkUrl })

  let lastCpu = process.cpuUsage()
  let lastTick = process.hrtime.bigint()
  const systemSampler = setInterval(async () => {
    const mem = process.memoryUsage()
    const currentCpu = process.cpuUsage()
    const currentTick = process.hrtime.bigint()
    const elapsedMs = Number(currentTick - lastTick) / 1_000_000
    const cpuDelta = (currentCpu.user - lastCpu.user) + (currentCpu.system - lastCpu.system)
    const lagMs = Math.max(0, elapsedMs - 1000)
    lastCpu = currentCpu
    lastTick = currentTick

    metrics.sampleSystem({
      timestamp: new Date().toISOString(),
      rssMb: mem.rss / 1024 / 1024,
      heapUsedMb: mem.heapUsed / 1024 / 1024,
      eventLoopLagMs: lagMs,
      cpuPercent: elapsedMs > 0 ? (cpuDelta / 1000) / elapsedMs * 100 : 0,
    })
    metrics.sampleBacklog(await sampleBacklog(connection))
  }, 1000)

  const loops = Array.from({ length: concurrency }, (_, index) => interactiveScenario.start(index, getDesiredConcurrency, isRunning))
  const background = [
    webhookProducer.start(isRunning),
  ]

  if (mode !== 'app-only') {
    background.push(workflowPoller.start(isRunning))
    background.push(notificationPoller.start(isRunning))
  }

  await sleep(durationSeconds * 1000)
  running = false
  clearInterval(systemSampler)
  await Promise.allSettled([...loops, ...background])

  const summary = summarizeMetrics(metrics)
  const verdict = buildVerdict(summary, profile, durationSeconds)
  const report = {
    timestamp: new Date().toISOString(),
    profile: profile.name,
    seedTier: options.seedTier ?? 'smoke',
    topology,
    duration: durationSeconds,
    concurrency,
    rampStages: profile.rampStages,
    totalOperations: summary.totalOperations,
    throughputByOperation: Object.fromEntries(
      Object.entries(summary.operations).map(([name, op]) => [name, op.total / durationSeconds])
    ),
    latencySummaryByOperation: summary.operations,
    errorSummaryByOperation: Object.fromEntries(
      Object.entries(summary.operations).map(([name, op]) => [name, { error: op.error, sampleErrors: op.sampleErrors }])
    ),
    systemMetricsSummary: summary.system,
    backlogSummary: summary.backlog,
    backlogBaseline,
    backlogDelta: {
      pendingWorkflowCount: Math.max(0, summary.backlog.pendingWorkflowCount - backlogBaseline.pendingWorkflowCount),
      pendingNotificationCount: Math.max(0, summary.backlog.pendingNotificationCount - backlogBaseline.pendingNotificationCount),
      webhookBacklogCount: Math.max(0, summary.backlog.webhookBacklogCount - backlogBaseline.webhookBacklogCount),
    },
    errorRate: summary.errorRate,
    verdict: verdict.verdict,
    bottleneckNotes: verdict.notes,
  }

  const outputPath = options.output ?? resolve(defaultResultsDir, `${profile.name}-${Date.now()}.json`)
  ensureDir(defaultResultsDir)
  writeBenchmarkReport(outputPath, report)
  printBenchmarkSummary(report)

  await connection.close()
  await localApp?.stop?.()
  await localSink?.stop?.()

  return report
}
