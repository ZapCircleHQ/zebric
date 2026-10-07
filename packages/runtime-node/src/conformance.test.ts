import { expect } from 'vitest'
import { WorkflowManager } from './workflows/workflow-manager.js'
import { Hono } from 'hono'
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { CommandExecutor, defaultTheme } from '@zebric/runtime-core'
import { blueprint, runtimeConformance, session } from '../../../tests/runtime-conformance/contracts.js'
import { applyCsrfProtection, createApiKeyRegistry, applySecurityHeaders } from './engine/server-security.js'
import { DatabaseConnection } from './database/connection.js'
import { QueryExecutor } from './database/query-executor.js'
import { registerAPIRoutes, registerCommandRoutes, registerPageRoutes, registerOpenAPIRoute } from './engine/server-routes.js'

runtimeConformance('Node SQLite', async () => {
  const connection = new DatabaseConnection({ type: 'sqlite', filename: ':memory:' }, blueprint)
  await connection.connect()
  const queries = new QueryExecutor(connection)
  const app = new Hono()
  const sessionManager = { getSession: async () => session }
  const apiKeys = createApiKeyRegistry(['writer', 'reader'].map(name => ({ token: `${name}-key`, credential: {
    name, agentId: name, credentialId: name, displayName: name, roles: ['operator'],
    scopes: name === 'writer' ? ['*'] : ['entity.item.list', 'entity.item.get'],
  } })))
  app.use('*', async (c, next) => {
    const rejection = await applyCsrfProtection(c, 'csrf-token', apiKeys)
    if (rejection) return rejection
    await next()
    applySecurityHeaders(c, 'conformance-request', 'conformance-trace')
  })
  const deps = { blueprint, queryExecutor: queries, sessionManager, apiKeys }
  registerOpenAPIRoute(app, blueprint, { port: 3000 } as Parameters<typeof registerOpenAPIRoute>[2])
  registerAPIRoutes(app, deps as Parameters<typeof registerAPIRoutes>[1])
  const commands = new CommandExecutor(blueprint, { queryExecutor: queries })
  registerCommandRoutes(app, { ...deps, commandExecutor: commands } as Parameters<typeof registerCommandRoutes>[1])
  const workflows = new WorkflowManager({ dataLayer: queries, commandExecutor: commands })
  workflows.setCommandExecutor(commands)
  for (const workflow of blueprint.workflows ?? []) workflows.registerWorkflow(workflow as Parameters<typeof workflows.registerWorkflow>[0])
  registerPageRoutes(app, new BlueprintHttpAdapter({ blueprint, queryExecutor: queries, sessionManager, theme: defaultTheme }))
  return { queries, commands, fetch: (path, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('cookie')) headers.set('cookie', 'csrf-token=conformance')
    if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', 'conformance')
    return app.request(`https://test.example${path}`, { ...init, headers })
  }, runWorkflow: async name => {
    const job = workflows.trigger(name, { session })
    await workflows.ensurePersisted(job.id)
    await expect.poll(async () => (await workflows.getDurableJob(job.id))?.status, { timeout: 5000 }).toMatch(/completed|failed|cancelled/)
    return (await workflows.getDurableJob(job.id))!.status
  }, cleanup: async () => { await workflows.shutdown(); await connection.close() } }
})
