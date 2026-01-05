import { appendFile } from 'node:fs/promises'
import type { NotificationAdapter, NotificationPayload } from '../types.js'

export interface SimpleEmailAdapterConfig {
  from: string
  outboxFile?: string
}

export class EmailAdapter implements NotificationAdapter {
  readonly name: string
  readonly type = 'email'
  private from: string
  private outbox: string

  constructor(name: string, config: SimpleEmailAdapterConfig) {
    this.name = name
    this.from = config.from
    this.outbox = config.outboxFile || './data/email-outbox.log'
  }

  async send(message: NotificationPayload): Promise<void> {
    if (!message.to) {
      throw new Error('Email adapter requires "to"')
    }
    const subject = message.subject || 'Notification'
    const body = message.body || ''

    const entry = [
      `=== Email via ${this.name} ===`,
      `From: ${this.from}`,
      `To: ${message.to}`,
      `Subject: ${subject}`,
      '',
      body,
      '\n',
    ].join('\n')

    await appendFile(this.outbox, entry, { encoding: 'utf-8' })
  }
}
