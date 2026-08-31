import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createZebric, type Zebric } from '@zebric/runtime-node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createZebricMcpServer } from '../src/server.js'

describe('Task Tracker flagship MCP example', () => {
  const apiKey = 'task-tracker-mcp-e2e-key'
  let temporaryRoot = ''
  let zebric: Zebric | undefined
  let applicationUrl = ''
  let previousApiKey: string | undefined

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'zebric-task-tracker-mcp-'))
    const port = await findOpenPort()
    applicationUrl = `http://127.0.0.1:${port}`
    previousApiKey = process.env.TASK_TRACKER_API_KEY
    process.env.TASK_TRACKER_API_KEY = apiKey
    zebric = await createZebric({
      blueprintPath: fileURLToPath(new URL('../../../examples/task-tracker/blueprint.toml', import.meta.url)),
      host: '127.0.0.1',
      port,
      databaseUrl: `sqlite://${join(temporaryRoot, 'task-tracker.db')}`,
      dev: true,
      devConfig: { hotReload: false, adminPort: 0, rateLimit: { max: 1_000 } },
      validateBeforeStart: true,
      logLevel: 'error',
    })
    await waitForHttp(`${applicationUrl}/health`, 15_000)
  }, 30_000)

  afterAll(async () => {
    if (zebric) await zebric.stop()
    if (previousApiKey === undefined) delete process.env.TASK_TRACKER_API_KEY
    else process.env.TASK_TRACKER_API_KEY = previousApiKey
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('creates, lists, gets, and updates a task through an MCP client', async () => {
    const server = await createZebricMcpServer({
      applicationUrl,
      applicationName: 'task_tracker',
      credential: () => apiKey,
      allowedMutations: ['task_tracker_create_task', 'task_tracker_set_task_status'],
    })
    const client = new Client({ name: 'task-tracker-e2e', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)

    try {
      const listedTools = await client.listTools()
      expect(listedTools.tools.map(tool => tool.name).sort()).toEqual([
        'task_tracker_task_tracker_create_task',
        'task_tracker_task_tracker_get_task',
        'task_tracker_task_tracker_list_tasks',
        'task_tracker_task_tracker_set_task_status',
      ])

      const created = parseToolJson(await client.callTool({
        name: 'task_tracker_task_tracker_create_task',
        arguments: { title: 'Ship the flagship MCP example' },
      })) as { id: string; title: string; status: string; priority: string }
      expect(created).toEqual(expect.objectContaining({
        title: 'Ship the flagship MCP example', status: 'not_started', priority: 'normal',
      }))

      const tasks = parseToolJson(await client.callTool({
        name: 'task_tracker_task_tracker_list_tasks',
        arguments: { status: 'not_started' },
      })) as Array<{ id: string }>
      expect(tasks.map(task => task.id)).toContain(created.id)

      const fetched = parseToolJson(await client.callTool({
        name: 'task_tracker_task_tracker_get_task', arguments: { id: created.id },
      })) as { id: string; title: string }
      expect(fetched).toEqual(expect.objectContaining({ id: created.id, title: created.title }))

      const updated = parseToolJson(await client.callTool({
        name: 'task_tracker_task_tracker_set_task_status',
        arguments: { id: created.id, status: 'in_progress' },
      })) as { id: string; status: string }
      expect(updated).toEqual(expect.objectContaining({ id: created.id, status: 'in_progress' }))
    } finally {
      await client.close()
      await server.close()
    }
  }, 20_000)
})

function parseToolJson(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  if (result.isError) throw new Error(`MCP tool failed: ${JSON.stringify(result.content)}`)
  const text = result.content.find(content => content.type === 'text')
  if (!text || text.type !== 'text') throw new Error('MCP tool returned no text content')
  return JSON.parse(text.text)
}

async function findOpenPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a TCP port'))
        return
      }
      server.close(() => resolvePromise(address.port))
    })
    server.on('error', reject)
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Runtime is still starting.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}
