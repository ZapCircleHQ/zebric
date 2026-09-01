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
  let auditPath = ''
  let claimIssueId = ''
  let rejectedIssueId = ''
  let previousAgentKey: string | undefined
  let previousSeederKey: string | undefined

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-agent-cli-e2e-'))
    const blueprintPath = join(tmpRoot, 'blueprint.toml')
    const dbPath = join(tmpRoot, 'app.db')
    auditPath = join(tmpRoot, 'app.audit.log')
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
    claimIssueId = (await postJson('/api/issues', seederKey, {
      title: 'CLI Mutation Test', qaState: 'ready_to_test', columnId: ready.id, position: 1, important: true,
    }) as { id: string }).id
    rejectedIssueId = (await postJson('/api/issues', seederKey, {
      title: 'CLI Rejected Mutation Test', qaState: 'ready_to_test', columnId: ready.id, position: 2, important: true,
    }) as { id: string }).id
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
      expect(result.stdout).toContain('Found Ready to Test issue: CLI Black Box Test.')
      expect(transcript.completedTurns).toBe(3)
    } finally {
      await modelServer.close()
    }
  }, 30_000)

  it('approves an exact mutation, observes its job, attributes it, and deduplicates a repeated CLI run', async () => {
    const runId = 'cli-black-box-claim-run'
    const firstTranscript = new IssueBoardClaimTranscript(claimIssueId)
    const firstServer = await startScriptedModelServer(request => firstTranscript.next(request))
    try {
      const first = await runCli(firstServer.url, 'Claim the CLI Mutation Test issue.', [
        '--approve-operation', 'issue_board_claim_issue_for_qa', '--run-id', runId,
      ])
      expect(first, `CLI failed: ${first.stderr || first.stdout}`).toMatchObject({ exitCode: 0, stderr: '' })
      expect(first.stdout).toContain('The issue was claimed for QA.')
      expect(firstTranscript.completedTurns).toBe(2)
    } finally {
      await firstServer.close()
    }

    expect(await getJson(`/api/agent/issues/${claimIssueId}`)).toEqual(expect.objectContaining({
      qaState: 'testing', qaRunId: runId, claimedBy: 'zebric-qa-agent',
    }))

    const retryTranscript = new IssueBoardClaimTranscript(claimIssueId)
    const retryServer = await startScriptedModelServer(request => retryTranscript.next(request))
    try {
      const retry = await runCli(retryServer.url, 'Retry claiming the CLI Mutation Test issue.', [
        '--approve-operation', 'issue_board_claim_issue_for_qa', '--run-id', runId,
      ])
      expect(retry, `CLI retry failed: ${retry.stderr || retry.stdout}`).toMatchObject({ exitCode: 0, stderr: '' })
      expect(retry.stdout).toContain('The issue was claimed for QA.')
    } finally {
      await retryServer.close()
    }

    const auditEntries = (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(auditEntries).toContainEqual(expect.objectContaining({
      eventType: 'agent.action', actionName: 'issue_board.claim_issue_for_qa',
      actorType: 'agent', agentId: 'zebric-qa-agent', credentialId: 'issue-board-e2e-key',
      runId, success: true,
    }))
    expect(auditEntries.filter(entry => entry.eventType === 'workflow.completed'
      && entry.workflowName === 'ClaimIssueForQA' && entry.runId === runId)).toHaveLength(1)
  }, 30_000)

  it('rejects a mutation not named by the CLI approval allowlist without changing state', async () => {
    const transcript = new IssueBoardRejectedClaimTranscript(rejectedIssueId)
    const modelServer = await startScriptedModelServer(request => transcript.next(request))
    try {
      const result = await runCli(modelServer.url, 'Claim the rejected mutation issue.', [
        '--approve-operation', 'issue_board_complete_qa', '--run-id', 'cli-rejected-run',
      ])
      expect(result).toMatchObject({ exitCode: 4, stderr: '' })
      expect(result.stdout).toContain('APPROVAL_REJECTED')
      expect(result.stdout).toContain('Zebric mutation was not approved')
      expect(transcript.completedTurns).toBe(1)
    } finally {
      await modelServer.close()
    }
    expect(await getJson(`/api/agent/issues/${rejectedIssueId}`)).toEqual(expect.objectContaining({
      qaState: 'ready_to_test', qaRunId: null, claimedBy: null,
    }))
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
        expect(issues).toContainEqual(expect.objectContaining({ title: 'CLI Black Box Test' }))
        this.completedTurns++
        return { content: 'Found Ready to Test issue: CLI Black Box Test.' }
      }
      throw new Error(`Unexpected model turn ${this.completedTurns + 1}`)
    }
  }

  class IssueBoardClaimTranscript {
    completedTurns = 0
    constructor(private readonly issueId: string) {}

    next(request: ScriptedModelRequest): ScriptedModelResponse {
      expect(request.tools.map(tool => tool.name)).toContain('connected_issue_board_claim_issue_for_qa')
      const last = request.messages.at(-1)
      if (this.completedTurns === 0) {
        expect(last?.type).toBe('human')
        this.completedTurns++
        return { toolCalls: [{
          name: 'connected_issue_board_claim_issue_for_qa', args: { id: this.issueId },
          id: 'claim-ready-issue', type: 'tool_call',
        }] }
      }
      if (this.completedTurns === 1) {
        expect(last?.type).toBe('tool')
        expect(JSON.parse(String(last?.content))).toEqual(expect.objectContaining({
          workflow: 'ClaimIssueForQA', status: 'succeeded',
        }))
        this.completedTurns++
        return { content: 'The issue was claimed for QA.' }
      }
      throw new Error(`Unexpected claim model turn ${this.completedTurns + 1}`)
    }
  }

  class IssueBoardRejectedClaimTranscript {
    completedTurns = 0
    constructor(private readonly issueId: string) {}

    next(request: ScriptedModelRequest): ScriptedModelResponse {
      expect(request.tools.map(tool => tool.name)).toContain('connected_issue_board_claim_issue_for_qa')
      if (this.completedTurns === 0) {
        this.completedTurns++
        return { toolCalls: [{
          name: 'connected_issue_board_claim_issue_for_qa', args: { id: this.issueId },
          id: 'rejected-claim', type: 'tool_call',
        }] }
      }
      throw new Error(`Unexpected rejected-claim model turn ${this.completedTurns + 1}`)
    }
  }

  async function runCli(modelUrl: string, prompt: string, extraArguments: string[] = []) {
    const cliPath = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url))
    return runProcess(process.execPath, [
      cliPath, 'run', '--prompt', prompt, '--model', `scripted+${modelUrl}`,
      '--connect', baseUrl, '--credential-env', 'CLI_BLACK_BOX_AGENT_KEY',
      ...extraArguments, '--json',
    ], { ...process.env, CLI_BLACK_BOX_AGENT_KEY: agentKey })
  }

  async function getJson(path: string): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${agentKey}` } })
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`)
    return response.json()
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
