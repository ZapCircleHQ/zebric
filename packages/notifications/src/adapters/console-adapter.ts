import type { NotificationAdapter, NotificationPayload } from '../types.js'

export interface ConsoleAdapterOptions {
  prefix?: string
}

export class ConsoleLogAdapter implements NotificationAdapter {
  readonly name: string
  readonly type = 'console'
  private prefix: string

  constructor(name: string, options?: ConsoleAdapterOptions) {
    this.name = name
    this.prefix = options?.prefix || 'notify'
  }

  async send(message: NotificationPayload): Promise<void> {
    const output = {
      adapter: this.name,
      channel: message.channel,
      to: message.to,
      subject: message.subject,
      body: message.body,
      metadata: message.metadata,
    }
    console.log(`[${this.prefix}]`, output)
  }
}
