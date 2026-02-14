import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackAdapter } from '../src/adapters/slack-adapter.js'
import { createHmac } from 'node:crypto'

function signedHeaders(body: string, secret: string): HeadersInit {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const base = `v0:${timestamp}:${body}`
  const signature = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`
  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': signature,
  }
}

describe('SlackAdapter', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return new Response(JSON.stringify({ ok: true, received: body }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as any
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends channel text payload by default', async () => {
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test',
      defaultChannel: '#dispatch'
    })

    await adapter.send({
      body: 'hello'
    })

    expect(global.fetch).toHaveBeenCalledOnce()
    const init = (global.fetch as any).mock.calls[0][1] as RequestInit
    const payload = JSON.parse(String(init.body))
    expect(payload.channel).toBe('#dispatch')
    expect(payload.text).toBe('hello')
  })

  it('supports metadata for thread and blocks', async () => {
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test'
    })

    await adapter.send({
      channel: '#dispatch',
      body: 'resolved',
      metadata: {
        threadTs: '1700000000.123456',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Resolved*' } }],
        mrkdwn: true
      }
    })

    const init = (global.fetch as any).mock.calls[0][1] as RequestInit
    const payload = JSON.parse(String(init.body))
    expect(payload.thread_ts).toBe('1700000000.123456')
    expect(payload.blocks).toHaveLength(1)
    expect(payload.mrkdwn).toBe(true)
  })

  it('ignores invalid threadTs metadata', async () => {
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test'
    })

    await adapter.send({
      channel: '#dispatch',
      body: 'resolved',
      metadata: {
        threadTs: 'https://slack.com/archives/C123/p1700000000123456'
      }
    })

    const init = (global.fetch as any).mock.calls[0][1] as RequestInit
    const payload = JSON.parse(String(init.body))
    expect(payload.thread_ts).toBeUndefined()
  })

  it('handles Slack url_verification challenge payload', async () => {
    const secret = 'slack-signing-secret'
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test',
      signingSecret: secret
    })

    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'abc123'
    })
    const request = new Request('http://example.com/notifications/slack_dispatch/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders(body, secret)
      },
      body
    })

    const response = await adapter.handleRequest(request)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('abc123')
  })

  it('handles form-encoded slash command payload', async () => {
    const secret = 'slack-signing-secret'
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test',
      signingSecret: secret
    })

    const params = new URLSearchParams()
    params.set('command', '/zebric')
    params.set('text', 'help')
    const body = params.toString()
    const request = new Request('http://example.com/notifications/slack_dispatch/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...signedHeaders(body, secret)
      },
      body
    })

    const response = await adapter.handleRequest(request)
    expect(response.status).toBe(200)
    const payload = await response.json() as any
    expect(payload.response_type).toBe('ephemeral')
    expect(payload.text).toContain('/zebric')
  })

  it('rejects inbound request with invalid signature', async () => {
    const adapter = new SlackAdapter('slack_dispatch', {
      botToken: 'xoxb-test',
      signingSecret: 'expected-secret'
    })

    const body = JSON.stringify({ type: 'event_callback' })
    const request = new Request('http://example.com/notifications/slack_dispatch/inbound', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...signedHeaders(body, 'wrong-secret')
      },
      body
    })

    const response = await adapter.handleRequest(request)
    expect(response.status).toBe(401)
  })
})
