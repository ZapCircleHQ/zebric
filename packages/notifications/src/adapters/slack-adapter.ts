import type { NotificationAdapter, NotificationPayload } from '../types.js'
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SlackAdapterConfig {
  botToken: string
  defaultChannel?: string
  signingSecret?: string
}

interface SlackMessageMetadata {
  threadTs?: string
  thread_ts?: string
  blocks?: any[]
  mrkdwn?: boolean
  unfurlLinks?: boolean
  unfurl_links?: boolean
  unfurlMedia?: boolean
  unfurl_media?: boolean
}

export class SlackAdapter implements NotificationAdapter {
  readonly name: string
  readonly type = 'slack'
  private config: SlackAdapterConfig

  constructor(name: string, config: SlackAdapterConfig) {
    this.name = name
    this.config = config
  }

  async send(message: NotificationPayload): Promise<void> {
    const channel = message.channel || message.to || this.config.defaultChannel
    if (!channel) {
      throw new Error('Slack adapter requires a channel')
    }

    const metadata = (message.metadata || {}) as SlackMessageMetadata
    const threadTs = metadata.threadTs || metadata.thread_ts
    const text = message.body || message.subject || 'Notification'
    const payload: Record<string, any> = {
      channel,
      text,
    }

    const normalizedThreadTs = this.normalizeThreadTs(threadTs)
    if (normalizedThreadTs) {
      payload.thread_ts = normalizedThreadTs
    }
    if (Array.isArray(metadata.blocks)) {
      payload.blocks = metadata.blocks
    }
    if (typeof metadata.mrkdwn === 'boolean') {
      payload.mrkdwn = metadata.mrkdwn
    }

    const unfurlLinks = metadata.unfurlLinks ?? metadata.unfurl_links
    if (typeof unfurlLinks === 'boolean') {
      payload.unfurl_links = unfurlLinks
    }

    const unfurlMedia = metadata.unfurlMedia ?? metadata.unfurl_media
    if (typeof unfurlMedia === 'boolean') {
      payload.unfurl_media = unfurlMedia
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.config.botToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Slack API error: ${errorText}`)
    }

    const json: any = await response.json()
    if (!json.ok) {
      throw new Error(`Slack API error: ${json.error || 'unknown_error'}`)
    }
  }

  /**
   * Handle inbound Slack requests (events API / slash command callbacks).
   */
  async handleRequest(request: Request): Promise<Response> {
    if (!this.config.signingSecret) {
      return Response.json(
        { error: 'Slack signing secret not configured' },
        { status: 500 }
      )
    }

    const rawBody = await request.text()
    if (!this.verifySlackSignature(request, rawBody, this.config.signingSecret)) {
      return Response.json({ error: 'Invalid Slack signature' }, { status: 401 })
    }

    const payload = this.parseInboundPayloadFromRaw(rawBody, request.headers.get('content-type') || '')

    // Slack Events API URL verification challenge
    if (payload?.type === 'url_verification' && typeof payload.challenge === 'string') {
      return new Response(payload.challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    }

    // Slash commands or interactive callbacks can be acknowledged immediately.
    if (typeof payload?.command === 'string') {
      return Response.json({
        response_type: 'ephemeral',
        text: `Received ${payload.command}`
      })
    }

    // For event callbacks we currently acknowledge and rely on downstream workflows.
    if (payload?.type === 'event_callback') {
      return Response.json({ ok: true })
    }

    return Response.json({ ok: true })
  }

  private normalizeThreadTs(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    // Slack thread timestamps are decimal strings like "1700000000.123456".
    if (!/^\d+\.\d+$/.test(trimmed)) {
      return undefined
    }
    return trimmed
  }

  private parseInboundPayloadFromRaw(rawBody: string, contentType: string): Record<string, any> {
    try {
      if (contentType.includes('application/json')) {
        return rawBody ? JSON.parse(rawBody) as Record<string, any> : {}
      }

      if (
        contentType.includes('application/x-www-form-urlencoded')
        || contentType.includes('multipart/form-data')
      ) {
        const params = new URLSearchParams(rawBody)
        const payloadParam = params.get('payload')
        if (payloadParam) {
          try {
            return JSON.parse(payloadParam) as Record<string, any>
          } catch {
            // fall through to parsed params object
          }
        }
        return Object.fromEntries(params.entries())
      }

      if (!rawBody) {
        return {}
      }

      try {
        return JSON.parse(rawBody) as Record<string, any>
      } catch {
        return { text: rawBody }
      }
    } catch {
      return {}
    }
  }

  private verifySlackSignature(request: Request, rawBody: string, signingSecret: string): boolean {
    const timestamp = request.headers.get('x-slack-request-timestamp')
    const signature = request.headers.get('x-slack-signature')
    if (!timestamp || !signature) {
      return false
    }

    const ts = Number.parseInt(timestamp, 10)
    if (!Number.isFinite(ts)) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > 60 * 5) {
      return false
    }

    const base = `v0:${timestamp}:${rawBody}`
    const computed = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`

    const sigBuffer = Buffer.from(signature, 'utf8')
    const computedBuffer = Buffer.from(computed, 'utf8')
    if (sigBuffer.length !== computedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, computedBuffer)
  }
}
