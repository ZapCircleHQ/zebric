import type { NotificationAdapter, NotificationPayload } from '../types.js'

export interface SlackAdapterConfig {
  botToken: string
  defaultChannel?: string
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
   * Basic handler for slash commands or mentions.
   * For now we just acknowledge the request to keep the adapter extensible.
   */
  async handleRequest(_request: Request): Promise<Response> {
    return new Response('Slack event received', { status: 200 })
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
}
