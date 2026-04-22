export interface NotificationAdapterConfig {
  name: string
  type: string
  config?: Record<string, unknown>
}

export interface NotificationsConfig {
  default?: string
  adapters: NotificationAdapterConfig[]
}

export interface NotificationMessage {
  adapter?: string
  channel?: string
  to?: string
  subject?: string
  body?: string
  template?: string
  params?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface NotificationPayload {
  channel?: string
  to?: string
  subject?: string
  body?: string
  metadata?: Record<string, unknown>
}

export interface NotificationAdapter {
  name: string
  type: string
  send(message: NotificationPayload): Promise<void>
  handleRequest?(request: Request): Promise<Response>
}
