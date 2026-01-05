import type { NotificationAdapter, NotificationPayload } from '../types.js'

export interface SlackAdapterConfig {
  botToken: string
  defaultChannel?: string
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
    const channel = message.channel || this.config.defaultChannel
    if (!channel) {
      throw new Error('Slack adapter requires a channel')
    }

    const text = message.body || message.subject || 'Notification'
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.config.botToken}`,
      },
      body: JSON.stringify({
        channel,
        text,
      }),
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
}
