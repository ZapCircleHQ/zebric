import type { UserSession } from './auth/session.js'
import { escapeHtml } from './security/html-escape.js'

/** Platform-neutral data exposed to a blueprint behavior. */
export interface BehaviorContext {
  data: any
  helpers: BehaviorHelpers
  params?: Record<string, string>
  session?: UserSession | null
}

/** Pure helpers shared by every behavior execution environment. */
export interface BehaviorHelpers {
  today: () => string
  now: () => string
  formatDate: (date: string) => string
  formatDateTime: (date: string) => string
  escapeHtml: (value: string) => string
}

export type BehaviorFunction = (context: BehaviorContext) => string | Promise<string>
export type BehaviorHandler = (context: BehaviorContext) => any | Promise<any>

export function createBehaviorHelpers(clock: () => Date = () => new Date()): BehaviorHelpers {
  return {
    today: () => clock().toISOString().split('T')[0] || '',
    now: () => clock().toISOString(),
    formatDate: (date: string) => new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    formatDateTime: (date: string) => new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    escapeHtml: (value: string) => escapeHtml(value),
  }
}
