import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import { WorkflowManager } from '../workflows/workflow-manager.js'
import { registerWebhookRoutes } from './server-routes.js'

function createApp(secretEnv?: string) {
  const manager = new WorkflowManager({ dataLayer: {} as any })
  manager.registerWorkflow({
    name: 'privileged',
    trigger: { webhook: '/webhooks/privileged', webhookSecretEnv: secretEnv },
    steps: [],
  })
  const app = new Hono()
  registerWebhookRoutes(app, manager)
  return { app, manager }
}

afterEach(() => vi.unstubAllEnvs())

describe('workflow webhook authentication', () => {
  it('fails closed when no secret is configured', async () => {
    const { app, manager } = createApp('MISSING_AUDIT_SECRET')
    const response = await app.request('/webhooks/privileged', { method: 'POST', body: '{}' })
    expect(response.status).toBe(503)
    expect(manager.getJobs()).toHaveLength(0)
  })

  it('rejects invalid credentials and accepts a bearer secret', async () => {
    vi.stubEnv('AUDIT_WEBHOOK_SECRET', 'test-secret')
    const { app, manager } = createApp('AUDIT_WEBHOOK_SECRET')
    const denied = await app.request('/webhooks/privileged', { method: 'POST', body: '{}' })
    expect(denied.status).toBe(401)
    const accepted = await app.request('/webhooks/privileged', {
      method: 'POST', body: '{}', headers: { authorization: 'Bearer test-secret' },
    })
    expect(accepted.status).toBe(200)
    expect(manager.getJobs()).toHaveLength(1)
  })

  it('accepts a current body-bound HMAC and rejects replay outside five minutes', async () => {
    vi.stubEnv('AUDIT_WEBHOOK_SECRET', 'test-secret')
    const { app } = createApp('AUDIT_WEBHOOK_SECRET')
    const body = '{"event":"approved"}'
    const request = (timestamp: number) => app.request('/webhooks/privileged', {
      method: 'POST', body, headers: {
        'content-type': 'application/json',
        'x-zebric-webhook-timestamp': String(timestamp),
        'x-zebric-webhook-signature': `sha256=${createHmac('sha256', 'test-secret').update(`${timestamp}.${body}`).digest('hex')}`,
      },
    })
    expect((await request(Math.floor(Date.now() / 1000))).status).toBe(200)
    expect((await request(Math.floor(Date.now() / 1000) - 301)).status).toBe(401)
  })
})
