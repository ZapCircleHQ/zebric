import { test as base } from '@playwright/test'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createZebric, type Zebric } from '../../../dist/programmatic.js'

type ZebricServer = {
  baseURL: string
  blueprintPath: string
  dbPath: string
  tmpRoot: string
}

type Fixtures = {
  app: ZebricServer
}

export const test = base.extend<Fixtures>({
  app: [
    async ({}, use) => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-playwright-'))
      const dbPath = join(tmpRoot, 'app.db')
      const blueprintPath = join(tmpRoot, 'blueprint.toml')
      const sourceBlueprint = resolve(process.cwd(), '../../examples/zebric-dispatch/blueprint.toml')
      const port = await findOpenPort()
      const baseURL = `http://127.0.0.1:${port}`
      let zebric: Zebric | undefined

      try {
        await writeFile(blueprintPath, await readFile(sourceBlueprint, 'utf8'), 'utf8')

        zebric = await createZebric({
          blueprintPath,
          host: '127.0.0.1',
          port,
          databaseUrl: `sqlite://${dbPath}`,
          validateBeforeStart: false,
        })

        await waitForHttp(`${baseURL}/health`, 15_000)
        await use({ baseURL, blueprintPath, dbPath, tmpRoot })
      } finally {
        if (zebric) {
          await zebric.stop()
        }
        await rm(tmpRoot, { recursive: true, force: true })
      }
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'

async function findOpenPort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a TCP port'))
        return
      }
      const port = address.port
      server.close(() => resolvePromise(port))
    })
    server.on('error', reject)
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }

  throw new Error(`Timed out waiting for server: ${url}`)
}
