import { createServer } from 'node:http'
import { openBenchmarkDatabase, sleep } from '../lib/runtime.mjs'
import { BenchmarkMetrics } from './metricsCollector.mjs'
import { createWorkflowPoller } from '../scenarios/workflowPoller.mjs'
import { createNotificationPoller } from '../scenarios/notificationPoller.mjs'

export async function runWorker(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for benchmark worker')
  }

  const sinkUrl = options.sinkUrl ?? process.env.NOTIFICATION_SINK_URL ?? 'http://notification-sink:3210'
  const healthHost = options.host ?? '0.0.0.0'
  const healthPort = Number(options.healthPort ?? process.env.BENCHMARK_WORKER_HEALTH_PORT ?? 3300)
  const metrics = new BenchmarkMetrics()
  const { connection } = await openBenchmarkDatabase(databaseUrl)

  let running = true

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        workflowOps: metrics.operations.get('processWorkflow')?.total ?? 0,
        notificationOps: metrics.operations.get('sendNotification')?.total ?? 0,
      }))
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  await new Promise((resolvePromise) => server.listen(healthPort, healthHost, resolvePromise))

  const workflowPoller = createWorkflowPoller({ connection, metrics, workerId: options.workerId })
  const notificationPoller = createNotificationPoller({ connection, metrics, sinkUrl })

  const stop = async () => {
    if (!running) return
    running = false
    await new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise())
    })
    await connection.close()
  }

  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })

  await Promise.allSettled([
    workflowPoller.start(() => running),
    notificationPoller.start(() => running),
  ])

  while (running) {
    await sleep(250)
  }
}
