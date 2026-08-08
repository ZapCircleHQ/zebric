import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-agent-e2e-'))
    const blueprintPath = join(tmpRoot, 'blueprint.toml')
    const dbPath = join(tmpRoot, 'app.db')
    const sourceBlueprint = resolve(process.cwd(), '../../examples/issue-board/blueprint.toml')
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
      devConfig: { hotReload: false, adminPort: 0, dbPath },
      validateBeforeStart: true,
      logLevel: 'error',
    })
    await waitForHttp(`${baseUrl}/health`, 15_000)
    await seedIssueBoard(baseUrl, agentKey)
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
    expect(issues).toEqual([
      expect.objectContaining({
        title: 'Deterministic Agent API Test',
        acceptanceCriteria: 'The agent finds this issue through the Ready to Test queue.',
        revision: 'e2e-revision',
      }),
    ])

    const issueOutput = await driver.invoke({
      tool: 'issue_board_issue_board_get_issue',
      input: { id: issues[0]!.id },
    })
    expect(JSON.parse(String(issueOutput))).toEqual(expect.objectContaining({
      id: issues[0]!.id,
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
})

async function seedIssueBoard(baseUrl: string, credential: string): Promise<void> {
  const ready = await postJson(baseUrl, credential, '/api/columns', {
    key: 'ready_to_test', name: 'Ready to Test', position: 0,
  }) as { id: string }
  await postJson(baseUrl, credential, '/api/issues', {
    title: 'Deterministic Agent API Test',
    description: 'Seeded through the real Zebric entity API.',
    acceptanceCriteria: 'The agent finds this issue through the Ready to Test queue.',
    testUrl: `${baseUrl}/`,
    revision: 'e2e-revision',
    columnId: ready.id,
    position: 0,
    important: true,
  })
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
