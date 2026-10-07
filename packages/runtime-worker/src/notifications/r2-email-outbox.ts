import type { NotificationAdapter, NotificationAdapterConfig, NotificationPayload } from '@zebric/notifications/portable'

/** Mirrors Node's development email outbox using one durable R2 object per message. */
export class R2EmailOutbox implements NotificationAdapter {
  readonly type = 'email'
  readonly name: string
  private readonly from: string
  private readonly prefix: string
  constructor(config: NotificationAdapterConfig, private readonly bucket: R2Bucket | undefined) {
    this.name = config.name
    if (!bucket) throw new Error('Email outbox requires FILES or a custom email notification factory')
    if (typeof config.config?.from !== 'string' || !config.config.from) throw new Error('Email adapter requires "from" configuration')
    this.from = config.config.from
    this.prefix = `_zebric/email-outbox/${String(config.config.outboxPrefix ?? config.name).replace(/\/+$/, '')}`
  }
  async send(message: NotificationPayload): Promise<void> {
    if (!message.to) throw new Error('Email adapter requires "to"')
    const entry = [`=== Email via ${this.name} ===`, `From: ${this.from}`, `To: ${message.to}`,
      `Subject: ${message.subject || 'Notification'}`, '', message.body || '', '\n'].join('\n')
    await this.bucket!.put(`${this.prefix}/${Date.now()}-${crypto.randomUUID()}.txt`, entry,
      { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })
  }
}
