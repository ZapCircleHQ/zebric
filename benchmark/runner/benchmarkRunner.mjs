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

const TRACKED_ROUTE_METRICS = new Set([
  '/',
  '/requests',
  '/requests/open',
  '/requests/high-priority',
  '/api/requests',
  '/api/requestcomments',
  '/api/webhookevents',
  '/api/workflowruns',
  '/api/auditevents',
  '/api/approvalsteps',
  '/api/notifications',
])

function parseMetricLabels(input) {
  const labels = {}
  if (!input) return labels

  const pattern = /(\w+)="([^"]*)"/g
  let match
  while ((match = pattern.exec(input))) {
    labels[match[1]] = match[2]
  }
  return labels
}

function parsePrometheusMetrics(text) {
  const metrics = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)$/.exec(trimmed)
    if (!match) continue
    const value = Number(match[3])
    if (!Number.isFinite(value)) continue
    metrics.push({
      name: match[1],
      labels: parseMetricLabels(match[2]),
      value,
    })
  }
  return metrics
}

function metricsByKey(entries) {
  return new Map(entries.map((entry) => [
    `${entry.name}|${JSON.stringify(entry.labels)}`,
    entry.value,
  ]))
}

function metricValue(entries, name, labels = {}) {
  return entries.find((entry) =>
    entry.name === name
    && JSON.stringify(entry.labels) === JSON.stringify(labels)
  )?.value ?? 0
}

function diffMetricEntries(startEntries, endEntries, predicate) {
  const startMap = metricsByKey(startEntries.filter(predicate))
  const endMap = metricsByKey(endEntries.filter(predicate))
  const keys = new Set([...startMap.keys(), ...endMap.keys()])
  return Array.from(keys)
    .map((key) => {
      const [, labelsJson] = key.split('|')
      return {
        labels: JSON.parse(labelsJson),
        delta: (endMap.get(key) ?? 0) - (startMap.get(key) ?? 0),
      }
    })
    .filter((entry) => entry.delta !== 0)
}

function summarizeAdminMetrics(entries) {
  const requestRoutes = diffMetricEntries(
    [],
    entries,
    (entry) => entry.name === 'zbl_requests_by_route_total' && TRACKED_ROUTE_METRICS.has(entry.labels.route)
  )
  const requestStatus = diffMetricEntries(
    [],
    entries,
    (entry) => entry.name === 'zbl_requests_by_status_total'
  )
  const queryEntities = diffMetricEntries(
    [],
    entries,
    (entry) => entry.name === 'zbl_query_duration_ms_count'
  ).map((entry) => ({
    entity: entry.labels.entity,
    count: entry.delta,
    totalMs: metricValue(entries, 'zbl_query_duration_ms_sum', { entity: entry.labels.entity }),
  }))

  return {
    totalRequests: metricValue(entries, 'zbl_requests_total'),
    requestDurationMs: {
      count: metricValue(entries, 'zbl_request_duration_ms_count'),
      sumMs: metricValue(entries, 'zbl_request_duration_ms_sum'),
    },
    requestsByRoute: Object.fromEntries(
      requestRoutes
        .sort((a, b) => a.labels.route.localeCompare(b.labels.route))
        .map((entry) => [entry.labels.route, entry.delta])
    ),
    requestsByStatus: Object.fromEntries(
      requestStatus
        .sort((a, b) => a.labels.status.localeCompare(b.labels.status))
        .map((entry) => [entry.labels.status, entry.delta])
    ),
    queryEntities: Object.fromEntries(
      queryEntities
        .sort((a, b) => a.entity.localeCompare(b.entity))
        .map((entry) => [entry.entity, {
          count: entry.count,
          totalMs: Number(entry.totalMs.toFixed(3)),
        }])
    ),
  }
}

function diffAdminMetricSummaries(startEntries, endEntries) {
  const routeDeltas = diffMetricEntries(
    startEntries,
    endEntries,
    (entry) => entry.name === 'zbl_requests_by_route_total' && TRACKED_ROUTE_METRICS.has(entry.labels.route)
  )
  const statusDeltas = diffMetricEntries(
    startEntries,
    endEntries,
    (entry) => entry.name === 'zbl_requests_by_status_total'
  )
  const queryCounts = diffMetricEntries(
    startEntries,
    endEntries,
    (entry) => entry.name === 'zbl_query_duration_ms_count'
  )

  return {
    totalRequests: metricValue(endEntries, 'zbl_requests_total') - metricValue(startEntries, 'zbl_requests_total'),
    requestDurationMs: {
      count: metricValue(endEntries, 'zbl_request_duration_ms_count') - metricValue(startEntries, 'zbl_request_duration_ms_count'),
      sumMs: Number((
        metricValue(endEntries, 'zbl_request_duration_ms_sum') - metricValue(startEntries, 'zbl_request_duration_ms_sum')
      ).toFixed(3)),
    },
    requestsByRoute: Object.fromEntries(
      routeDeltas
        .sort((a, b) => a.labels.route.localeCompare(b.labels.route))
        .map((entry) => [entry.labels.route, entry.delta])
    ),
    requestsByStatus: Object.fromEntries(
      statusDeltas
        .sort((a, b) => a.labels.status.localeCompare(b.labels.status))
        .map((entry) => [entry.labels.status, entry.delta])
    ),
    queryEntities: Object.fromEntries(
      queryCounts
        .sort((a, b) => a.labels.entity.localeCompare(b.labels.entity))
        .map((entry) => {
          const entity = entry.labels.entity
          return [entity, {
            count: entry.delta,
            totalMs: Number((
              metricValue(endEntries, 'zbl_query_duration_ms_sum', { entity })
              - metricValue(startEntries, 'zbl_query_duration_ms_sum', { entity })
            ).toFixed(3)),
          }]
        })
    ),
  }
}

function defaultAdminMetricsUrls(topology, port) {
  if (topology === 'local') {
    return [`http://127.0.0.1:${Number(port) + 30}/metrics`]
  }
  if (topology === 'compose-single') {
    return ['http://zebric-app-single:3030/metrics']
  }
  if (topology === 'compose-multi') {
    return [
      'http://zebric-app-multi-1:3030/metrics',
      'http://zebric-app-multi-2:3030/metrics',
      'http://zebric-app-multi-3:3030/metrics',
    ]
  }
  return []
}

function resolveAdminMetricsUrls(options, topology, port) {
  const explicit = options.adminMetricsUrls
    ?? options.adminMetricsUrl
    ?? process.env.BENCHMARK_ADMIN_METRICS_URLS
    ?? process.env.BENCHMARK_ADMIN_METRICS_URL

  if (explicit) {
    return String(explicit)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }

  return defaultAdminMetricsUrls(topology, port)
}

async function scrapeAdminMetrics(urls) {
  const results = []
  for (const url of urls) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        results.push({ url, ok: false, status: response.status, error: `HTTP ${response.status}` })
        continue
      }
      const text = await response.text()
      const parsed = parsePrometheusMetrics(text)
      results.push({
        url,
        ok: true,
        summary: summarizeAdminMetrics(parsed),
        parsed,
      })
    } catch (error) {
      results.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
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
  const appPort = Number(options.port ?? 3200)
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
      port: appPort,
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
  const adminMetricsUrls = resolveAdminMetricsUrls(options, topology, appPort)
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
  const adminMetricsStart = await scrapeAdminMetrics(adminMetricsUrls)

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
  const adminMetricsEnd = await scrapeAdminMetrics(adminMetricsUrls)

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
    adminMetrics: adminMetricsUrls.length === 0 ? null : adminMetricsUrls.map((url) => {
      const start = adminMetricsStart.find((entry) => entry.url === url)
      const end = adminMetricsEnd.find((entry) => entry.url === url)
      return {
        url,
        start: start?.ok ? start.summary : { ok: false, error: start?.error ?? 'not-scraped' },
        end: end?.ok ? end.summary : { ok: false, error: end?.error ?? 'not-scraped' },
        delta: start?.ok && end?.ok ? diffAdminMetricSummaries(start.parsed, end.parsed) : null,
      }
    }),
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
