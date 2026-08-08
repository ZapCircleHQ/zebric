import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createZebric, type Zebric } from '@zebric/runtime-node'
import { createRuntimeReadTools } from '../../src/runtime/action-tool-factory.js'
import { discoverZebricApplication } from '../../src/runtime/discovery-client.js'
import { DeterministicAgentDriver } from '../../src/testing/deterministic-driver.js'

describe('Zebric Agent deterministic E2E', () => {
  let tmpRoot = ''
  let zebric: Zebric | undefined
  let baseUrl = ''
  let previousAgentKey: string | undefined
  const agentKey = 'deterministic-e2e-agent-key'
  let seededIssues: { complete: string; needsWork: string; race: string; rollback: string }

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-agent-e2e-'))
    const blueprintPath = join(tmpRoot, 'blueprint.toml')
    const dbPath = join(tmpRoot, 'app.db')
    const sourceBlueprint = fileURLToPath(new URL('../../../../examples/issue-board/blueprint.toml', import.meta.url))
    await writeFile(blueprintPath, await readFile(sourceBlueprint, 'utf8'), 'utf8')

    previousAgentKey = process.env.ISSUE_BOARD_AGENT_API_KEY
    process.env.ISSUE_BOARD_AGENT_API_KEY = agentKey
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
    seededIssues = await seedIssueBoard(baseUrl, agentKey)
  }, 45_000)

  afterAll(async () => {
    if (zebric) await zebric.stop()
    if (previousAgentKey === undefined) delete process.env.ISSUE_BOARD_AGENT_API_KEY
    else process.env.ISSUE_BOARD_AGENT_API_KEY = previousAgentKey
    if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
  })

  it('discovers and executes the Ready to Test lookup through generated tools', async () => {
    const contract = await discoverZebricApplication(baseUrl)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'issue_board',
      credential: () => agentKey,
    })
    const driver = new DeterministicAgentDriver(tools)

    const columnsOutput = await driver.invoke({
      tool: 'issue_board_issue_board_list_columns',
      input: { key: 'ready_to_test' },
    })
    const columns = JSON.parse(String(columnsOutput)) as Array<{ id: string; key: string }>
    expect(columns).toHaveLength(1)
    expect(columns[0]!.key).toBe('ready_to_test')

    const issuesOutput = await driver.invoke({
      tool: 'issue_board_issue_board_list_issues',
      input: { columnId: columns[0]!.id },
    })
    const issues = JSON.parse(String(issuesOutput)) as Array<Record<string, unknown>>
    expect(issues).toHaveLength(4)
    const issue = issues.find(item => item.title === 'Deterministic Agent API Test')!
    expect(issue).toEqual(expect.objectContaining({
      acceptanceCriteria: 'The agent finds this issue through the Ready to Test queue.',
      revision: 'e2e-revision',
    }))

    const issueOutput = await driver.invoke({
      tool: 'issue_board_issue_board_get_issue',
      input: { id: issue.id },
    })
    expect(JSON.parse(String(issueOutput))).toEqual(expect.objectContaining({
      id: issue.id,
      testUrl: `${baseUrl}/`,
    }))
    expect(driver.transcript.map(entry => entry.tool)).toEqual([
      'issue_board_issue_board_list_columns',
      'issue_board_issue_board_list_issues',
      'issue_board_issue_board_get_issue',
    ])
  })

  it('rejects invalid simulated input before it reaches Zebric', async () => {
    const contract = await discoverZebricApplication(baseUrl)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'issue_board',
      credential: () => agentKey,
    })
    const driver = new DeterministicAgentDriver(tools)

    await expect(driver.invoke({
      tool: 'issue_board_issue_board_list_columns',
      input: { key: 'not_a_real_column' },
    })).rejects.toThrow()
    expect(driver.transcript).toEqual([])
  })

  it('approves, atomically claims, retries, and observes the workflow job', async () => {
    const approvals: Array<{ operationId: string; input: Record<string, unknown> }> = []
    const contract = await discoverZebricApplication(baseUrl)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'issue_board',
      credential: () => agentKey,
      mutations: {
        approve: request => {
          approvals.push({ operationId: request.operationId, input: request.input })
          return true
        },
        idempotencyKey: (_operationId, input) => `claim:${input.id}:${input.runId}`,
        pollIntervalMs: 5,
      },
    })
    const driver = new DeterministicAgentDriver(tools)
    const call = {
      tool: 'issue_board_issue_board_claim_issue_for_qa',
      input: { id: seededIssues.complete, runId: 'qa-run-1' },
    }

    const firstOutput = await driver.invoke(call)
    const firstJob = JSON.parse(String(firstOutput))
    expect(firstJob.status).toBe('succeeded')
    expect(firstJob.result.claimedIssue).toEqual(expect.objectContaining({
      id: seededIssues.complete,
      qaState: 'testing',
      qaRunId: 'qa-run-1',
      claimedBy: 'issue-board-agent',
    }))

    const retryOutput = await driver.invoke(call)
    expect(JSON.parse(String(retryOutput)).id).toBe(firstJob.id)
    expect(approvals).toHaveLength(2)

    const issueResponse = await fetch(`${baseUrl}/api/agent/issues/${seededIssues.complete}`, {
      headers: { authorization: `Bearer ${agentKey}` },
    })
    expect(await issueResponse.json()).toEqual(expect.objectContaining({
      qaState: 'testing', qaRunId: 'qa-run-1', claimedBy: 'issue-board-agent',
    }))
  })

  it('returns a conflict when another run claims the already claimed issue', async () => {
    const contract = await discoverZebricApplication(baseUrl)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'issue_board',
      credential: () => agentKey,
      mutations: {
        approve: () => true,
        idempotencyKey: (_operationId, input) => `claim:${input.id}:${input.runId}`,
      },
    })
    const driver = new DeterministicAgentDriver(tools)

    await expect(driver.invoke({
      tool: 'issue_board_issue_board_claim_issue_for_qa',
      input: { id: seededIssues.complete, runId: 'qa-run-2' },
    })).rejects.toThrow('HTTP 409')
    expect(driver.transcript).toEqual([])
  })

  it('allows exactly one winner in a synchronized two-agent claim race', async () => {
    const contract = await discoverZebricApplication(baseUrl)
    const makeDriver = (runId: string) => new DeterministicAgentDriver(createRuntimeReadTools(contract, {
      applicationName: 'issue_board', credential: () => agentKey,
      mutations: {
        approve: () => true,
        idempotencyKey: () => `race:${seededIssues.race}:${runId}`,
        pollIntervalMs: 2,
      },
    }))
    const calls = ['race-run-a', 'race-run-b'].map(runId => makeDriver(runId).invoke({
      tool: 'issue_board_issue_board_claim_issue_for_qa',
      input: { id: seededIssues.race, runId },
    }))

    const settled = await Promise.allSettled(calls)
    const succeeded = settled.filter(result => result.status === 'fulfilled'
      && JSON.parse(String(result.value)).status === 'succeeded')
    expect(succeeded).toHaveLength(1)

    const issue = await getJson(baseUrl, agentKey, `/api/agent/issues/${seededIssues.race}`) as any
    expect(issue.qaState).toBe('testing')
    expect(['race-run-a', 'race-run-b']).toContain(issue.qaRunId)
  })

  it('records a passing result and moves the issue to QA Completed', async () => {
    const driver = await mutationDriver(baseUrl, agentKey)
    const output = await driver.invoke({
      tool: 'issue_board_issue_board_complete_qa',
      input: {
        id: seededIssues.complete,
        resultId: 'qa-result-complete',
        runId: 'qa-run-1',
        summary: 'Acceptance criteria passed.',
        checks: [{ name: 'Board loads', status: 'passed' }],
        evidence: [{ type: 'test_log', url: 'artifact://qa-run-1/log' }],
        testedRevision: 'e2e-revision',
      },
    })
    expect(JSON.parse(String(output))).toMatchObject({
      status: 'succeeded',
      result: {
        completedIssue: { qaState: 'qa_completed' },
        qaResult: { outcome: 'qa_completed', agentRunId: 'qa-run-1' },
      },
    })

    const results = JSON.parse(String(await driver.invoke({
      tool: 'issue_board_issue_board_list_qa_results',
      input: { issueId: seededIssues.complete },
    })))
    expect(results).toEqual([expect.objectContaining({
      outcome: 'qa_completed', testedRevision: 'e2e-revision',
    })])
  })

  it('records a failing result and moves a separately claimed issue to Needs Work', async () => {
    const driver = await mutationDriver(baseUrl, agentKey)
    await driver.invoke({
      tool: 'issue_board_issue_board_claim_issue_for_qa',
      input: { id: seededIssues.needsWork, runId: 'qa-run-needs-work' },
    })
    const output = await driver.invoke({
      tool: 'issue_board_issue_board_mark_qa_needs_work',
      input: {
        id: seededIssues.needsWork,
        resultId: 'qa-result-needs-work',
        runId: 'qa-run-needs-work',
        summary: 'Empty title causes a server error.',
        checks: [{ name: 'Empty title validation', status: 'failed' }],
        evidence: [],
        testedRevision: 'e2e-revision',
      },
    })
    expect(JSON.parse(String(output))).toMatchObject({
      status: 'succeeded',
      result: {
        completedIssue: { qaState: 'needs_work' },
        qaResult: { outcome: 'needs_work' },
      },
    })
  })

  it('rolls back the issue transition when QA result creation fails', async () => {
    const driver = await mutationDriver(baseUrl, agentKey)
    await driver.invoke({
      tool: 'issue_board_issue_board_claim_issue_for_qa',
      input: { id: seededIssues.rollback, runId: 'qa-run-rollback' },
    })

    await expect(driver.invoke({
      tool: 'issue_board_issue_board_complete_qa',
      input: {
        id: seededIssues.rollback,
        resultId: 'qa-result-complete',
        runId: 'qa-run-rollback',
        summary: 'This result ID deliberately collides.',
        checks: [{ name: 'Rollback check', status: 'passed' }],
        evidence: [],
        testedRevision: 'e2e-revision',
      },
    })).rejects.toThrow()

    const issue = await getJson(baseUrl, agentKey, `/api/agent/issues/${seededIssues.rollback}`) as any
    expect(issue).toEqual(expect.objectContaining({
      qaState: 'testing',
      qaRunId: 'qa-run-rollback',
    }))
    const results = JSON.parse(String(await driver.invoke({
      tool: 'issue_board_issue_board_list_qa_results',
      input: { issueId: seededIssues.rollback },
    })))
    expect(results).not.toContainEqual(expect.objectContaining({ issueId: seededIssues.rollback }))
  })
})

async function seedIssueBoard(
  baseUrl: string,
  credential: string
): Promise<{ complete: string; needsWork: string; race: string; rollback: string }> {
  const ready = await postJson(baseUrl, credential, '/api/columns', {
    key: 'ready_to_test', name: 'Ready to Test', position: 0,
  }) as { id: string }
  await postJson(baseUrl, credential, '/api/columns', {
    key: 'needs_work', name: 'Needs Work', position: 1,
  })
  await postJson(baseUrl, credential, '/api/columns', {
    key: 'qa_completed', name: 'QA Completed', position: 2,
  })
  const createIssue = async (title: string, position: number) => postJson(baseUrl, credential, '/api/issues', {
    title,
    description: 'Seeded through the real Zebric entity API.',
    acceptanceCriteria: 'The agent finds this issue through the Ready to Test queue.',
    testUrl: `${baseUrl}/`, revision: 'e2e-revision', qaState: 'ready_to_test',
    columnId: ready.id, position, important: true,
  }) as Promise<{ id: string }>
  const complete = await createIssue('Deterministic Agent API Test', 0)
  const needsWork = await createIssue('Deterministic Needs Work Test', 1)
  const race = await createIssue('Deterministic Claim Race Test', 2)
  const rollback = await createIssue('Deterministic Transaction Rollback Test', 3)
  return { complete: complete.id, needsWork: needsWork.id, race: race.id, rollback: rollback.id }
}

async function mutationDriver(baseUrl: string, credential: string): Promise<DeterministicAgentDriver> {
  const contract = await discoverZebricApplication(baseUrl)
  return new DeterministicAgentDriver(createRuntimeReadTools(contract, {
    applicationName: 'issue_board', credential: () => credential,
    mutations: {
      approve: () => true,
      idempotencyKey: (operationId, input) => `${operationId}:${input.id}:${input.runId}`,
      pollIntervalMs: 2,
    },
  }))
}

async function getJson(baseUrl: string, credential: string, path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${credential}` },
  })
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`)
  return response.json()
}

async function postJson(
  baseUrl: string,
  credential: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Seed request ${path} failed: ${response.status} ${await response.text()}`)
  return response.json()
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
