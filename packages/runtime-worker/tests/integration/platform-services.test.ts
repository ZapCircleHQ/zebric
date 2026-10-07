import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import type { Blueprint, Plugin } from '@zebric/runtime-core'
import { ZebricWorkersEngine } from '../../src/engine.js'

describe('Workers platform services', () => {
  let mf: Miniflare
  let DB: D1Database
  let FILES: R2Bucket
  const blueprint: Blueprint = {
    version: '0.6.0', project: { name: 'Services', version: '1.0.0', runtime: { min_version: '0.6.0' } },
    entities: [{ name: 'Item', fields: [{ name: 'id', type: 'Text', primary_key: true }, { name: 'title', type: 'Text' }, { name: 'payload', type: 'JSON' }] }], pages: [],
  }
  beforeAll(async () => {
    mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28', d1Databases: { DB: 'services' }, r2Buckets: { FILES: 'files' } })
    DB = await mf.getD1Database('DB')
    FILES = await mf.getR2Bucket('FILES')
    await DB.exec('CREATE TABLE Item (id TEXT PRIMARY KEY, title TEXT, payload TEXT)')
  })
  afterAll(async () => { await mf?.dispose() })

  it('serves stored files with MIME types and hides private outbox objects', async () => {
    const engine = new ZebricWorkersEngine({ env: { DB, FILES }, blueprint })
    await engine.getStorage()!.store('nested/note.txt', 'hello', 'text/plain')
    const response = await engine.fetch(new Request('https://app.example/uploads/nested/note.txt'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('hello')
    expect((await engine.fetch(new Request('https://app.example/uploads/missing'))).status).toBe(404)
    await FILES.put('_zebric/email-outbox/private.txt', 'private')
    expect((await engine.fetch(new Request('https://app.example/uploads/_zebric/email-outbox/private.txt'))).status).toBe(404)
    expect((await engine.fetch(new Request('https://app.example/uploads/nested/%2e%2e%2fnote.txt'))).status).toBe(404)
  })

  it('initializes bundled plugins once under concurrent requests and uses their workflow actions', async () => {
    const init = vi.fn(async () => {})
    const action = vi.fn(async (_params, context) => {
      await context.db.create('Item', { id: 'plugin-created', title: 'Plugin' })
    })
    const repeat = vi.fn(async params => ({ message: params.message }))
    const plugin: Plugin = { name: 'bundled', version: '1.0.0', provides: { workflows: ['create'] }, init, workflows: { create: action }, integrations: { echo: { repeat } } }
    const engine = new ZebricWorkersEngine({ env: { DB, FILES }, plugins: { bundled: plugin }, blueprint: { ...blueprint,
      plugins: [{ name: 'bundled', enabled: true, config: { marker: 'init' } }],
      services: [{ name: 'echo', plugin: 'bundled', operations: { repeat: {
        input: { message: { type: 'Text', required: true } }, result: { type: 'Object', fields: { message: { type: 'Text', required: true } } },
      } } }],
      workflows: [{ name: 'PluginWorkflow', trigger: { manual: true }, steps: [
        { type: 'plugin', plugin: 'bundled', action_name: 'create' },
        { type: 'service', service: 'echo', operation: 'repeat', params: { message: 'Typed service' }, assignTo: 'echo' },
      ] }],
    } })
    await Promise.all([engine.fetch(new Request('https://app.example/health')), engine.fetch(new Request('https://app.example/health'))])
    expect(init).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ blueprint: expect.any(Object) }), { marker: 'init' })
    const job = await engine.getWorkflowExecutor().triggerManual('PluginWorkflow', {})
    expect(job.status).toBe('completed')
    expect(action).toHaveBeenCalledTimes(1)
    expect(job.result!.echo).toEqual({ message: 'Typed service' })
    expect(repeat).toHaveBeenCalledTimes(1)
    expect((await DB.prepare('SELECT title FROM Item WHERE id = ?').bind('plugin-created').first())).toMatchObject({ title: 'Plugin' })
  })

  it('does not reinitialize partially failed plugins and fails closed on missing modules', async () => {
    const init = vi.fn(async () => { throw new Error('init failed') })
    const bp = { ...blueprint, plugins: [{ name: 'broken', enabled: true }] }
    expect(() => new ZebricWorkersEngine({ env: { DB }, blueprint: bp })).toThrow('must be bundled')
    const engine = new ZebricWorkersEngine({ env: { DB }, blueprint: bp,
      plugins: { broken: { name: 'broken', version: '1', provides: {}, init } } })
    await expect(engine.ensureReady()).rejects.toThrow('init failed')
    await expect(engine.ensureReady()).rejects.toThrow('init failed')
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('records security failures in D1 and exposes bounded route metrics', async () => {
    const sessionManager = { getSession: async () => ({ user: { id: 'user' } }) as any }
    const engine = new ZebricWorkersEngine({ env: { DB }, blueprint, sessionManager })
    const response = await engine.fetch(new Request('https://app.example/api/items', { method: 'POST',
      headers: { cookie: 'csrf-token=expected', 'x-csrf-token': 'wrong' } }))
    expect(response.status).toBe(403)
    const events = await DB.prepare('SELECT entry_json FROM _zebric_audit').all<{ entry_json: string }>()
    expect(events.results.map(row => JSON.parse(row.entry_json).eventType)).toContain('csrf.violation')
    const metrics = await (await engine.fetch(new Request('https://app.example/metrics'))).text()
    expect(metrics).toContain('zbl_requests_total 1')
    expect(metrics).toContain('zbl_requests_by_status_total{status="4xx"} 1')
    expect(engine.getMetrics().totalRequests).toBe(2)
  })

  it('authenticates Slack callbacks before triggering notification workflows and skips verification challenges', async () => {
    const engine = new ZebricWorkersEngine({ env: { DB, SLACK_BOT_TOKEN: 'bot', SLACK_SIGNING_SECRET: 'signing' } as any,
      blueprint: { ...blueprint, notifications: { default: 'slack', adapters: [{ name: 'slack', type: 'slack' }] },
        workflows: [{ name: 'SlackInbound', trigger: { webhook: '/notifications/slack/inbound' },
          steps: [{ type: 'query', action: 'create', entity: 'Item', data: { id: '{{variables.webhook.body.event_id}}', title: 'Slack' } }] }] } })
    const post = async (body: object, valid = true) => {
      const raw = JSON.stringify(body)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('signing'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${raw}`)))
      return engine.fetch(new Request('https://app.example/notifications/slack/inbound', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
          'x-slack-signature': valid ? `v0=${Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')}` : 'v0=invalid' } }))
    }
    expect((await post({ type: 'event_callback', event_id: 'slack-denied' }, false)).status).toBe(401)
    expect(await DB.prepare('SELECT id FROM Item WHERE id = ?').bind('slack-denied').first()).toBeNull()
    expect(await (await post({ type: 'url_verification', challenge: 'challenge' })).text()).toBe('challenge')
    expect((await post({ type: 'event_callback', event_id: 'slack-accepted' })).status).toBe(200)
    expect(await DB.prepare('SELECT title FROM Item WHERE id = ?').bind('slack-accepted').first()).toMatchObject({ title: 'Slack' })
  })

  it('redacts nested secrets from structured JSON create audit entries', async () => {
    const engine = new ZebricWorkersEngine({ env: { DB }, blueprint })
    const response = await engine.fetch(new Request('https://app.example/api/items', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'json-audit', payload: { nested: { token: 'must-not-leak', visible: true } } }) }))
    expect(response.status).toBe(201)
    const entry = await DB.prepare('SELECT entry_json FROM _zebric_audit WHERE record_id = ?').bind('json-audit').first<{ entry_json: string }>()
    expect(entry!.entry_json).not.toContain('must-not-leak')
    expect(JSON.parse(entry!.entry_json).metadata.mutation.payload).toEqual({ nested: { visible: true } })
  })

  it('writes templated email notifications to a private R2 outbox', async () => {
    const engine = new ZebricWorkersEngine({ env: { DB, FILES }, blueprint: { ...blueprint,
      notifications: { default: 'email', adapters: [{ name: 'email', type: 'email', config: { from: 'app@example.test' } }] } } })
    await engine.getNotificationManager().send({ to: 'user@example.test', template: 'Hello {{name}}', params: { name: 'User' } })
    const files = await FILES.list({ prefix: '_zebric/email-outbox/email/' })
    expect(files.objects).toHaveLength(1)
    expect(await (await FILES.get(files.objects[0]!.key))!.text()).toContain('Hello User')
  })
})
