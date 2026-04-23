import { createServer } from 'node:http'

export async function startWebhookSimulator({
  host = '0.0.0.0',
  port = 3220,
  targetBaseUrl = process.env.BENCHMARK_BASE_URL ?? 'http://127.0.0.1:3200',
} = {}) {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, targetBaseUrl }))
      return
    }

    if (req.method === 'POST' && req.url === '/emit') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', async () => {
        const payload = JSON.parse(body || '{}')
        const burst = Number(payload.burstSize ?? 1)
        for (let index = 0; index < burst; index += 1) {
          await fetch(`${targetBaseUrl}/api/benchmark/webhooks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              requestId: payload.requestId,
              source: payload.source ?? 'simulator',
              eventType: payload.eventType ?? 'status_update',
              payload: { ordinal: index, simulated: true },
              deliveryKey: `${payload.deliveryKey ?? 'sim'}-${index}`,
            }),
          }).catch(() => {})
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, burst }))
      })
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  await new Promise((resolvePromise) => server.listen(port, host, resolvePromise))
  return {
    async stop() {
      await new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
      })
    },
  }
}
