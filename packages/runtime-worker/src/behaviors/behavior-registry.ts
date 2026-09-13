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

import { createBehaviorHelpers } from '@zebric/runtime-core'
import type { BehaviorContext, BehaviorFunction, BehaviorHandler } from '@zebric/runtime-core'

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

    const helpers = createBehaviorHelpers()
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

    const helpers = createBehaviorHelpers()
    const fullContext: BehaviorContext = {
      ...context,
      helpers
    }

    return await handler(fullContext)
  }

}
