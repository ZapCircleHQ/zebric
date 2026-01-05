import type {
  NotificationAdapter,
  NotificationAdapterConfig,
  NotificationMessage,
  NotificationPayload,
  NotificationsConfig,
} from './types.js'

type AdapterFactory = (config: NotificationAdapterConfig) => NotificationAdapter

const adapterFactories = new Map<string, AdapterFactory>()

export function registerNotificationAdapterFactory(type: string, factory: AdapterFactory): void {
  adapterFactories.set(type, factory)
}

function renderTemplate(template: string, params?: Record<string, any>): string {
  if (!template) return ''
  if (!params) return template
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key: string) => {
    const value = key
      .split('.')
      .reduce((acc: any, part: string) => (acc ? acc[part] : undefined), params as any)
    return value !== undefined && value !== null ? String(value) : ''
  })
}

function normalizeConfig(config?: NotificationsConfig): NotificationsConfig {
  if (config && config.adapters && config.adapters.length > 0) {
    return config
  }

  return {
    default: 'console',
    adapters: [
      {
        name: 'console',
        type: 'console',
      },
    ],
  }
}

export class NotificationManager {
  private adapters = new Map<string, NotificationAdapter>()
  private defaultAdapter?: string

  constructor(config?: NotificationsConfig) {
    const normalized = normalizeConfig(config)
    this.defaultAdapter = normalized.default

    for (const adapterConfig of normalized.adapters) {
      const factory = adapterFactories.get(adapterConfig.type)
      if (!factory) {
        console.warn(`No notification adapter registered for type "${adapterConfig.type}"`)
        continue
      }
      try {
        const adapter = factory(adapterConfig)
        this.adapters.set(adapterConfig.name, adapter)
      } catch (error) {
        console.error(`Failed to initialize notification adapter "${adapterConfig.name}":`, error)
      }
    }
  }

  listAdapters(): string[] {
    return Array.from(this.adapters.keys())
  }

  async send(message: NotificationMessage): Promise<void> {
    const adapterName = message.adapter || this.defaultAdapter
    if (!adapterName) {
      throw new Error('No notification adapter specified')
    }

    const adapter = this.adapters.get(adapterName)
    if (!adapter) {
      throw new Error(`Notification adapter not found: ${adapterName}`)
    }

    const payload: NotificationPayload = {
      channel: message.channel,
      to: message.to,
      subject: message.subject,
      body: message.body,
      metadata: message.metadata,
    }

    if (!payload.body && message.template) {
      payload.body = renderTemplate(message.template, message.params)
    }

    if (payload.subject && message.params) {
      payload.subject = renderTemplate(payload.subject, message.params)
    }

    await adapter.send(payload)
  }

  async handleRequest(adapterName: string, request: Request): Promise<Response> {
    const adapter = this.adapters.get(adapterName)
    if (!adapter || typeof adapter.handleRequest !== 'function') {
      return new Response('Adapter not found', { status: 404 })
    }

    return adapter.handleRequest(request)
  }
}
