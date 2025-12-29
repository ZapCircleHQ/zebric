export { NotificationManager, registerNotificationAdapterFactory } from './notification-manager.js'
export type {
  NotificationsConfig,
  NotificationAdapterConfig,
  NotificationMessage,
  NotificationAdapter,
} from './types.js'

import { registerNotificationAdapterFactory } from './notification-manager.js'
import { ConsoleLogAdapter } from './adapters/console-adapter.js'
import { SlackAdapter } from './adapters/slack-adapter.js'
import { EmailAdapter } from './adapters/email-adapter.js'

// Register built-in adapters
registerNotificationAdapterFactory('console', (config) => new ConsoleLogAdapter(config.name, config.config))
registerNotificationAdapterFactory('slack', (config) => {
  const { botToken, defaultChannel } = (config.config || {}) as { botToken?: string; defaultChannel?: string }
  if (!botToken) {
    throw new Error('Slack adapter requires botToken')
  }
  return new SlackAdapter(config.name, { botToken, defaultChannel })
})
registerNotificationAdapterFactory('email', (config) => {
  const { from, outboxFile } = (config.config || {}) as { from?: string; outboxFile?: string }
  if (!from) {
    throw new Error('Email adapter requires "from" configuration')
  }
  return new EmailAdapter(config.name, { from, outboxFile })
})
