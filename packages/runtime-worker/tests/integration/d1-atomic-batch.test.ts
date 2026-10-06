import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { D1WorkflowExecutor } from '../../src/workflows/d1-workflow-executor.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'
import { ZebricWorkersEngine } from '../../src/engine.js'

describe('D1 atomic batch', () => {
  let mf: Miniflare
  let adapter: D1Adapter

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'd1:transaction-test' },
    })
    adapter = new D1Adapter(await mf.getD1Database('DB'))
    await adapter.query('CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  })

  afterAll(async () => {
    await mf?.dispose()
  })

  it('commits every statement in a successful batch', async () => {
    await adapter.batch([
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['success-1', 'one'] },
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['success-2', 'two'] },
    ])
    const result = await adapter.query('SELECT id FROM records WHERE id LIKE ?', ['success-%'])
    expect(result.rows).toHaveLength(2)
  })

  it('rolls back every statement when one batch statement fails', async () => {
    await adapter.query('INSERT INTO records VALUES (?, ?)', ['collision', 'existing'])

    await expect(adapter.batch([
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['rolled-back', 'temporary'] },
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['collision', 'duplicate'] },
    ])).rejects.toThrow()

    const result = await adapter.query('SELECT id FROM records WHERE id = ?', ['rolled-back'])
    expect(result.rows).toEqual([])
  })

  it('rolls back an eligible Worker workflow when a later mutation fails', async () => {
    await adapter.query('INSERT INTO records VALUES (?, ?)', ['workflow-target', 'original'])
    await adapter.query('INSERT INTO records VALUES (?, ?)', ['workflow-collision', 'existing'])
    const engine = new ZebricWorkersEngine({
      env: { DB: await mf.getD1Database('DB'), AGENT_KEY: 'secret' } as any,
      blueprint: {
        version: '0.6.0',
        project: { name: 'atomic-workflow', version: '1.0.0', runtime: { min_version: '0.6.0' } },
        entities: [{
          name: 'records',
          fields: [
            { name: 'id', type: 'Text', primary_key: true },
            { name: 'value', type: 'Text', required: true },
          ],
        }],
        pages: [],
        workflows: [{
          name: 'RollbackPair',
          trigger: { manual: true },
          transactional: true,
          steps: [
            { type: 'query', entity: 'records', action: 'update', where: { id: 'workflow-target' }, data: { value: 'should-rollback' } },
            { type: 'query', entity: 'records', action: 'update', where: { id: 'workflow-collision', value: 'expected-other-state' }, data: { value: 'should-not-commit' } },
          ],
        }],
        skills: [{
          name: 'atomic', auth: 'required',
          actions: [{ name: 'rollback_pair', method: 'POST', path: '/api/atomic/rollback', workflow: 'RollbackPair', scopes: ['workflow.atomic'] }],
        }],
        auth: {
          providers: [],
          permissions: { operator: { allow: ['records.*'] } },
          apiKeys: [{ name: 'agent', keyEnv: 'AGENT_KEY', roles: ['operator'], scopes: ['workflow.atomic'] }],
        },
      } as any,
      authProvider: {
        getAuthInstance: () => ({ handler: () => new Response(null, { status: 204 }) }),
        getSession: async () => null,
        hasRole: () => false,
        ownsResource: () => false,
      },
    })

    const response = await engine.fetch(new Request('https://edge.example/api/atomic/rollback', {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'x-agent-run-id': 'atomic-run' },
      body: '{}',
    }))
    expect(response.status).toBe(202)
    const invocation = await response.json() as any
    expect(invocation.job.status).toBe('failed')

    const result = await adapter.query<{ value: string }>('SELECT value FROM records WHERE id = ?', ['workflow-target'])
    expect(result.rows).toEqual([{ value: 'original' }])
  })
  it('propagates entity events after commit and suppresses them after rollback', async () => {
    await adapter.query('INSERT INTO records VALUES (?, ?)', ['event-parent', 'original'])
    const blueprint = {
      entities: [{ name: 'records', fields: [{ name: 'id', type: 'Text', primary_key: true }, { name: 'value', type: 'Text' }] }],
      workflows: [
        { name: 'Commit', retries: 1, transactional: true, trigger: { manual: true }, steps: [{ type: 'query', entity: 'records', action: 'update', where: { id: 'event-parent' }, data: { value: 'committed' } }] },
        { name: 'Rollback', retries: 1, transactional: true, trigger: { manual: true }, steps: [
          { type: 'query', entity: 'records', action: 'update', where: { id: 'event-parent' }, data: { value: 'uncommitted' } },
          { type: 'query', entity: 'records', action: 'create', data: { id: 'event-parent', value: 'collision' } },
        ] },
        { name: 'Child', retries: 1, trigger: { entity: 'records', event: 'update' }, steps: [{ type: 'query', entity: 'records', action: 'create', data: { id: 'event-child', value: '{{variables.after.value}}' } }] },
      ],
    } as any
    const executor = new D1WorkflowExecutor(blueprint, adapter, new WorkersQueryExecutor(adapter, blueprint))
    expect((await executor.triggerManual('Rollback', {})).status).toBe('failed')
    expect(await executor.getJobs({ workflowName: 'Child' })).toEqual([])
    expect((await adapter.query('SELECT value FROM records WHERE id = ?', ['event-parent'])).rows).toEqual([{ value: 'original' }])
    expect((await executor.triggerManual('Commit', {})).status).toBe('completed')
    expect((await executor.getJobs({ workflowName: 'Child' }))[0].status).toBe('completed')
    expect((await adapter.query('SELECT value FROM records WHERE id = ?', ['event-child'])).rows).toEqual([{ value: 'committed' }])
  })

})
