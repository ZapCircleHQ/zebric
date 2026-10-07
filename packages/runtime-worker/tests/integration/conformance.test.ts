import { CommandExecutor } from '@zebric/runtime-core'
import { Miniflare } from 'miniflare'
import { blueprint, runtimeConformance, session } from '../../../../tests/runtime-conformance/contracts.js'
import { ZebricWorkersEngine } from '../../src/engine.js'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'

runtimeConformance('Workers D1', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-04-28', d1Databases: { DB: 'conformance' } })
  const DB = await mf.getD1Database('DB')
  await DB.exec('CREATE TABLE Item (id TEXT PRIMARY KEY, title TEXT, published INTEGER, priority INTEGER, status TEXT, payload TEXT, scheduledAt TEXT, createdAt TEXT, updatedAt TEXT)')
  const engine = new ZebricWorkersEngine({ env: { DB, WRITER_KEY: 'writer-key', READER_KEY: 'reader-key' } as any, blueprint, authProvider: { getAuthInstance: () => ({}), getSession: async () => session, hasRole: () => true, ownsResource: () => true, cleanup: async () => {} }, sessionManager: { getSession: async () => session } })
  const queries = new WorkersQueryExecutor(new D1Adapter(DB), blueprint)
  return {
    queries,
    commands: new CommandExecutor(blueprint, { queryExecutor: queries }),
    fetch: (path, init) => {
      const headers = new Headers(init?.headers)
      if (!headers.has('cookie')) headers.set('cookie', 'csrf-token=conformance')
      if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', 'conformance')
      return engine.fetch(new Request(`https://test.example${path}`, { ...init, headers }))
    },
    runWorkflow: async name => (await engine.getWorkflowExecutor().triggerManual(name, { session }, session)).status,
    cleanup: () => mf.dispose(),
  }
})
