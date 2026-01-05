export interface NotificationAdapterConfig {
  name: string
  type: string
  config?: Record<string, any>
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
  params?: Record<string, any>
  metadata?: Record<string, any>
}

export interface NotificationPayload {
  channel?: string
  to?: string
  subject?: string
  body?: string
  metadata?: Record<string, any>
}

export interface NotificationAdapter {
  name: string
  type: string
  send(message: NotificationPayload): Promise<void>
  handleRequest?(request: Request): Promise<Response>
}
