import { NotificationManager, type AdapterFactory } from './notification-manager.js'
import { ConsoleLogAdapter } from './adapters/console-adapter.js'
import { SlackAdapter } from './adapters/slack-adapter.js'
import type { NotificationsConfig } from './types.js'

export { NotificationManager }
export type { AdapterFactory }
export type * from './types.js'

/** Per-engine factories keep Worker secrets out of process.env and other isolates. */
export function createPortableNotificationManager(
  config?: NotificationsConfig,
  env: Readonly<Record<string, unknown>> = {},
  customFactories: ReadonlyMap<string, AdapterFactory> = new Map(),
): NotificationManager {
  const factories = new Map<string, AdapterFactory>([
    ['console', config => new ConsoleLogAdapter(config.name, config.config)],
    ['slack', config => {
      const options = config.config ?? {}
      const resolve = (key: string, fallback: string): string | undefined => {
        const value = options[key] ?? env[String(options[`${key}Env`] ?? fallback)]
        return typeof value === 'string' ? value : undefined
      }
      const botToken = resolve('botToken', 'SLACK_BOT_TOKEN')
      if (!botToken) throw new Error('Slack adapter requires botToken')
      return new SlackAdapter(config.name, {
        botToken,
        defaultChannel: resolve('defaultChannel', 'SLACK_DEFAULT_CHANNEL'),
        signingSecret: resolve('signingSecret', 'SLACK_SIGNING_SECRET'),
      })
    }],
  ])
  for (const [name, factory] of customFactories) factories.set(name, factory)
  for (const adapter of config?.adapters ?? []) {
    if (!factories.has(adapter.type)) throw new Error(`Notification adapter ${adapter.type} requires a portable factory`)
  }
  return new NotificationManager(config, factories, { strict: true })
}
