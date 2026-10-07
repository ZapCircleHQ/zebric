import { describe, expect, it } from 'vitest'
import { verifyWebhookRequest } from './webhook-auth.js'
import { ZebricWorkersEngine } from '../engine.js'
import { MockD1Database } from '../test-helpers/mocks.js'

async function signedRequest(body: string, seconds = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${seconds}.${body}`))
  const hex = [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, '0')).join('')
  return new Request('https://edge.example/webhooks/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zebric-webhook-timestamp': String(seconds),
      'x-zebric-webhook-signature': `sha256=${hex}`
    },
    body
  })
}

describe('Workers webhook authentication', () => {
  it('accepts valid bearer or HMAC credentials and rejects tampering and stale signatures', async () => {
    expect(
      await verifyWebhookRequest(
        new Request('https://edge.example', { headers: { authorization: 'Bearer secret' } }),
        '',
        'secret'
      )
    ).toBe(true)
    const request = await signedRequest('{"value":1}')
    expect(await verifyWebhookRequest(request, '{"value":1}', 'secret')).toBe(true)
    expect(await verifyWebhookRequest(request, '{"value":2}', 'secret')).toBe(false)
    expect(
      await verifyWebhookRequest(await signedRequest('{}', Math.floor(Date.now() / 1000) - 301), '{}', 'secret')
    ).toBe(false)
  })

  it('only dispatches workflows authorized by their own secret', async () => {
    const env = { DB: new MockD1Database(), ZEBRIC_WEBHOOK_SECRET: 'secret', OTHER_SECRET: 'different' } as any
    const blueprint = {
      version: '0.6.0',
      project: { name: 'Webhooks', version: '1', runtime: { min_version: '0.6.0' } },
      entities: [],
      pages: [],
      workflows: [
        { name: 'One', trigger: { webhook: '/webhooks/test' }, steps: [] },
        { name: 'Other', trigger: { webhook: '/webhooks/test', webhookSecretEnv: 'OTHER_SECRET' }, steps: [] }
      ]
    } as any
    const engine = new ZebricWorkersEngine({ env, blueprint })
    const response = await engine.fetch(await signedRequest('{}'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, jobs: [{ workflow: 'One', status: 'succeeded' }] })
    expect(
      (await engine.fetch(new Request('https://edge.example/webhooks/test', { method: 'POST', body: '{}' }))).status
    ).toBe(401)
    delete env.ZEBRIC_WEBHOOK_SECRET
    delete env.OTHER_SECRET
    expect((await engine.fetch(await signedRequest('{}'))).status).toBe(503)
  })
})
