import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackAdapter } from '../src/adapters/slack-adapter.js'

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
})
