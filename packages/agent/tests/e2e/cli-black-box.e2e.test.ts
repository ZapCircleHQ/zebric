import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createZebric, type Zebric } from '@zebric/runtime-node'
import type { ScriptedModelRequest, ScriptedModelResponse } from '../../src/testing/scripted-http-model.js'

describe('zebric-agent CLI black-box E2E', () => {
  const agentKey = 'cli-black-box-agent-key'
  const seederKey = 'cli-black-box-seeder-key'
  let tmpRoot = ''
  let zebric: Zebric | undefined
  let baseUrl = ''
  let previousAgentKey: string | undefined
  let previousSeederKey: string | undefined

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-agent-cli-e2e-'))
    const blueprintPath = join(tmpRoot, 'blueprint.toml')
    const dbPath = join(tmpRoot, 'app.db')
    const sourceBlueprint = fileURLToPath(new URL('../../../../examples/issue-board/blueprint.toml', import.meta.url))
    await writeFile(blueprintPath, await readFile(sourceBlueprint, 'utf8'), 'utf8')
    previousAgentKey = process.env.ISSUE_BOARD_AGENT_API_KEY
    previousSeederKey = process.env.ISSUE_BOARD_SEEDER_API_KEY
    process.env.ISSUE_BOARD_AGENT_API_KEY = agentKey
    process.env.ISSUE_BOARD_SEEDER_API_KEY = seederKey
    const port = await findOpenPort()
    baseUrl = `http://127.0.0.1:${port}`
    zebric = await createZebric({
      blueprintPath,
      host: '127.0.0.1',
      port,
      databaseUrl: `sqlite://${dbPath}`,
      dev: true,
      devConfig: { hotReload: false, adminPort: 0, dbPath, rateLimit: { max: 1_000 } },
      validateBeforeStart: true,
      logLevel: 'error',
    })
    await waitForHttp(`${baseUrl}/health`, 15_000)
    const ready = await postJson('/api/columns', seederKey, {
      key: 'ready_to_test', name: 'Ready to Test', position: 0,
    }) as { id: string }
    await postJson('/api/issues', seederKey, {
      title: 'CLI Black Box Test',
      description: 'Found through the packaged CLI and a deterministic model transcript.',
      qaState: 'ready_to_test',
      columnId: ready.id,
      position: 0,
      important: true,
    })
  }, 45_000)

  afterAll(async () => {
    if (zebric) await zebric.stop()
    if (previousAgentKey === undefined) delete process.env.ISSUE_BOARD_AGENT_API_KEY
    else process.env.ISSUE_BOARD_AGENT_API_KEY = previousAgentKey
    if (previousSeederKey === undefined) delete process.env.ISSUE_BOARD_SEEDER_API_KEY
    else process.env.ISSUE_BOARD_SEEDER_API_KEY = previousSeederKey
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  it('drives a running Zebric application through the compiled CLI and an exact model transcript', async () => {
    const transcript = new IssueBoardReadTranscript()
    const modelServer = await startScriptedModelServer(request => transcript.next(request))
    try {
      const cliPath = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url))
      const result = await runProcess(process.execPath, [
        cliPath,
        'run',
        '--prompt', 'Find the issues that are Ready to Test.',
        '--model', `scripted+${modelServer.url}`,
        '--connect', baseUrl,
        '--credential-env', 'CLI_BLACK_BOX_AGENT_KEY',
        '--json',
      ], { ...process.env, CLI_BLACK_BOX_AGENT_KEY: agentKey })

      expect(result, `CLI failed: ${result.stderr || result.stdout}`).toMatchObject({ exitCode: 0, stderr: '' })
      const output = JSON.parse(result.stdout) as { ok: boolean }
      expect(output.ok).toBe(true)
      expect(result.stdout).toContain('Found 1 Ready to Test issue: CLI Black Box Test.')
      expect(transcript.completedTurns).toBe(3)
    } finally {
      await modelServer.close()
    }
  }, 30_000)

  it('fails closed when the model request does not match its transcript', async () => {
    const modelServer = await startScriptedModelServer(() => {
      throw new Error('Expected a different first model request')
    })
    try {
      const cliPath = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url))
      const result = await runProcess(process.execPath, [
        cliPath,
        'run',
        '--prompt', 'Unexpected prompt.',
        '--model', `scripted+${modelServer.url}`,
        '--connect', baseUrl,
        '--credential-env', 'CLI_BLACK_BOX_AGENT_KEY',
        '--json',
      ], { ...process.env, CLI_BLACK_BOX_AGENT_KEY: agentKey })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('Scripted model rejected turn (409)')
      expect(result.stdout).toContain('Expected a different first model request')
    } finally {
      await modelServer.close()
    }
  }, 30_000)

  class IssueBoardReadTranscript {
    completedTurns = 0

    next(request: ScriptedModelRequest): ScriptedModelResponse {
      const toolNames = request.tools.map(tool => tool.name)
      expect(toolNames).toContain('connected_issue_board_list_columns')
      expect(toolNames).toContain('connected_issue_board_list_issues')
      const last = request.messages.at(-1)
      if (this.completedTurns === 0) {
        expect(last).toEqual(expect.objectContaining({
          type: 'human', content: 'Find the issues that are Ready to Test.',
        }))
        this.completedTurns++
        return { toolCalls: [{
          name: 'connected_issue_board_list_columns',
          args: { key: 'ready_to_test' },
          id: 'list-ready-column',
          type: 'tool_call',
        }] }
      }
      if (this.completedTurns === 1) {
        expect(last?.type).toBe('tool')
        const columns = JSON.parse(String(last?.content)) as Array<{ id: string; key: string }>
        expect(columns).toEqual([expect.objectContaining({ key: 'ready_to_test' })])
        this.completedTurns++
        return { toolCalls: [{
          name: 'connected_issue_board_list_issues',
          args: { columnId: columns[0]!.id },
          id: 'list-ready-issues',
          type: 'tool_call',
        }] }
      }
      if (this.completedTurns === 2) {
        expect(last?.type).toBe('tool')
        const issues = JSON.parse(String(last?.content)) as Array<{ title: string }>
        expect(issues).toEqual([expect.objectContaining({ title: 'CLI Black Box Test' })])
        this.completedTurns++
        return { content: 'Found 1 Ready to Test issue: CLI Black Box Test.' }
      }
      throw new Error(`Unexpected model turn ${this.completedTurns + 1}`)
    }
  }

  async function postJson(path: string, credential: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'x-agent-run-id': 'cli-black-box-seed-run',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Seed request ${path} failed: ${response.status} ${await response.text()}`)
    return response.json()
  }
})

async function startScriptedModelServer(
  respond: (request: ScriptedModelRequest) => ScriptedModelResponse
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/respond') throw new Error('Unexpected scripted-model route')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const result = respond(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ScriptedModelRequest)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(409, { 'content-type': 'text/plain' })
      response.end(error instanceof Error ? error.message : 'Unexpected scripted-model request')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to bind scripted model server')
  return {
    url: `http://127.0.0.1:${address.port}/v1/respond`,
    close: () => closeServer(server),
  }
}

async function closeServer(server: Server): Promise<void> {
  server.close()
  await once(server, 'close')
}

async function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const [exitCode] = await once(child, 'close') as [number]
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

async function findOpenPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a TCP port')
  const port = address.port
  await closeServer(server)
  return port
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Runtime is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}
