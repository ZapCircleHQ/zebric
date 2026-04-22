import { createServer } from 'node:http'

export async function startNotificationSink({
  host = '127.0.0.1',
  port = 3210,
  mode = 'normal',
} = {}) {
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, mode }))
      return
    }

    if (req.method === 'POST' && req.url === '/deliver') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', async () => {
        if (mode === 'slow') {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
        }
        if (mode === 'flaky' && Math.random() < 0.3) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, reason: 'simulated_failure' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, receivedBytes: body.length }))
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
