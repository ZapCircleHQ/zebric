/**
 * Behavior Registry for CloudFlare Workers
 *
 * Unlike Node.js which loads behaviors from files dynamically,
 * Workers requires behaviors to be bundled at build time.
 *
 * Usage:
 *   import renderTasks from './behaviors/render-tasks'
 *
 *   const handler = createWorkerHandler({
 *     behaviors: {
 *       'behaviors/render-tasks.js': renderTasks
 *     }
 *   })
 */

import type { UserSession } from '@zebric/runtime-core'

export interface BehaviorContext {
  data: any
  helpers: BehaviorHelpers
  params?: Record<string, string>
  session?: UserSession | null
}

export interface BehaviorHelpers {
  today: () => string
  now: () => string
  formatDate: (date: string) => string
  formatDateTime: (date: string) => string
  escapeHtml: (str: string) => string
}

export type BehaviorFunction = (context: BehaviorContext) => string | Promise<string>

export type BehaviorHandler = (context: BehaviorContext) => any | Promise<any>

/**
 * Behavior registry for Workers
 * Maps behavior paths to bundled functions
 */
export class BehaviorRegistry {
  private behaviors = new Map<string, BehaviorFunction | BehaviorHandler>()

  constructor(behaviors?: Record<string, BehaviorFunction | BehaviorHandler>) {
    if (behaviors) {
      Object.entries(behaviors).forEach(([path, fn]) => {
        this.register(path, fn)
      })
    }
  }

  /**
   * Register a behavior function
   */
  register(path: string, fn: BehaviorFunction | BehaviorHandler): void {
    this.behaviors.set(path, fn)
  }

  /**
   * Get a behavior function
   */
  get(path: string): BehaviorFunction | BehaviorHandler | undefined {
    return this.behaviors.get(path)
  }

  /**
   * Execute a render behavior
   */
  async executeRender(path: string, context: BehaviorContext): Promise<string> {
    const behavior = this.behaviors.get(path)
    if (!behavior) {
      throw new Error(`Behavior not found: ${path}`)
    }

    const helpers = this.createHelpers()
    const fullContext: BehaviorContext = {
      ...context,
      helpers
    }

    const result = await behavior(fullContext)
    return String(result)
  }

  /**
   * Execute a custom handler
   */
  async executeHandler(path: string, context: BehaviorContext): Promise<any> {
    const handler = this.behaviors.get(path)
    if (!handler) {
      throw new Error(`Handler not found: ${path}`)
    }

    const helpers = this.createHelpers()
    const fullContext: BehaviorContext = {
      ...context,
      helpers
    }

    return await handler(fullContext)
  }

  /**
   * Create helper functions
   */
  private createHelpers(): BehaviorHelpers {
    return {
      today: () => {
        const now = new Date()
        return now.toISOString().split('T')[0] || ''
      },

      now: () => {
        return new Date().toISOString()
      },

      formatDate: (date: string) => {
        const d = new Date(date)
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      },

      formatDateTime: (date: string) => {
        const d = new Date(date)
        return d.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      },

      escapeHtml: (str: string) => {
        return str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;')
      },
    }
  }
}
