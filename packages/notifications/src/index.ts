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
  const {
    botToken,
    botTokenEnv,
    defaultChannel,
    defaultChannelEnv
  } = (config.config || {}) as {
    botToken?: string
    botTokenEnv?: string
    defaultChannel?: string
    defaultChannelEnv?: string
  }

  const resolvedBotToken =
    botToken ||
    (botTokenEnv ? process.env[botTokenEnv] : undefined) ||
    process.env.SLACK_BOT_TOKEN

  const resolvedDefaultChannel =
    defaultChannel ||
    (defaultChannelEnv ? process.env[defaultChannelEnv] : undefined) ||
    process.env.SLACK_DEFAULT_CHANNEL

  if (!resolvedBotToken) {
    throw new Error('Slack adapter requires botToken')
  }
  return new SlackAdapter(config.name, { botToken: resolvedBotToken, defaultChannel: resolvedDefaultChannel })
})
registerNotificationAdapterFactory('email', (config) => {
  const { from, outboxFile } = (config.config || {}) as { from?: string; outboxFile?: string }
  if (!from) {
    throw new Error('Email adapter requires "from" configuration')
  }
  return new EmailAdapter(config.name, { from, outboxFile })
})
