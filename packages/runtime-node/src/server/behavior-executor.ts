import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import vm from 'node:vm'
import type { PageBehavior } from '@zebric/runtime-core'
import type { UserSession } from '@zebric/runtime-core'

/**
 * BehaviorExecutor
 *
 * Executes JavaScript behaviors defined in Blueprint pages.
 * Behaviors run in a controlled context with access to:
 * - data: Query results and data manipulation APIs
 * - helpers: Utility functions (date formatting, HTML escaping, etc.)
 * - params: Route parameters
 * - session: User session information
 *
 * Security:
 * - Behaviors run in VM sandbox (similar to limited plugins)
 * - No direct access to filesystem, network, or environment
 * - Only provided APIs are available
 */

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

export class BehaviorExecutor {
  private blueprintPath: string
  private cache: Map<string, string> = new Map()

  constructor(blueprintPath: string) {
    this.blueprintPath = blueprintPath
  }

  /**
   * Execute a render behavior
   * Returns HTML string to be sent to the client
   */
  async executeRender(
    behavior: PageBehavior,
    context: BehaviorContext
  ): Promise<string> {
    if (!behavior.render) {
      throw new Error('No render behavior defined')
    }

    const code = await this.loadBehaviorFile(behavior.render)
    const helpers = this.createHelpers()

    // Create execution context
    const vmContext = {
      data: context.data,
      helpers,
      params: context.params || {},
      session: context.session || null,
      // Safe built-ins
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      console: {
        log: (...args: any[]) => console.log('[BEHAVIOR]', ...args),
        warn: (...args: any[]) => console.warn('[BEHAVIOR]', ...args),
        error: (...args: any[]) => console.error('[BEHAVIOR]', ...args),
      },
    }

    try {
      // Execute the behavior code
      // The file should export a function via the last statement
      const result = vm.runInNewContext(code, vmContext, {
        timeout: 5000, // 5 second timeout
        displayErrors: true,
      })

      // If result is a function, call it with context
      if (typeof result === 'function') {
        const html = result({ data: context.data, helpers, params: context.params })
        return html
      }

      // Otherwise return the result directly
      return String(result)
    } catch (error) {
      console.error('Behavior execution error:', error)
      throw new Error(`Failed to execute render behavior: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Execute a custom behavior handler (e.g., on_status_click)
   * Returns result object
   */
  async executeHandler(
    behavior: PageBehavior,
    handlerName: string,
    context: BehaviorContext
  ): Promise<any> {
    const handlerPath = behavior[handlerName]
    if (!handlerPath) {
      throw new Error(`No handler '${handlerName}' defined in behavior`)
    }

    const code = await this.loadBehaviorFile(handlerPath)
    const helpers = this.createHelpers()

    // Create execution context with async support
    const vmContext = {
      data: context.data,
      helpers,
      params: context.params || {},
      session: context.session || null,
      // Safe built-ins
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      console: {
        log: (...args: any[]) => console.log('[BEHAVIOR]', ...args),
        warn: (...args: any[]) => console.warn('[BEHAVIOR]', ...args),
        error: (...args: any[]) => console.error('[BEHAVIOR]', ...args),
      },
    }

    try {
      // Execute the behavior code
      const result = vm.runInNewContext(code, vmContext, {
        timeout: 5000,
        displayErrors: true,
      })

      // If result is a function, call it with context
      if (typeof result === 'function') {
        return await result({ data: context.data, helpers, params: context.params })
      }

      return result
    } catch (error) {
      console.error('Behavior handler execution error:', error)
      throw new Error(`Failed to execute handler '${handlerName}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Load behavior JavaScript file
   * Uses simple caching for performance
   */
  private async loadBehaviorFile(relativePath: string): Promise<string> {
    // Check cache first
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath)!
    }

    // Resolve path relative to blueprint directory
    const blueprintDir = dirname(this.blueprintPath)
    const fullPath = join(blueprintDir, relativePath)

    try {
      const code = await readFile(fullPath, 'utf-8')
      this.cache.set(relativePath, code)
      return code
    } catch (error) {
      throw new Error(`Failed to load behavior file '${relativePath}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Create helper functions available to behaviors
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

  /**
   * Clear the behavior file cache
   * Useful for development hot-reload
   */
  clearCache(): void {
    this.cache.clear()
  }
}
