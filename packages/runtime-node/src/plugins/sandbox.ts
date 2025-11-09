/**
 * Plugin Sandbox
 *
 * Provides VM-based sandboxing for limited-trust plugins.
 * Controls access to capabilities like database, network, filesystem, and storage.
 *
 * Note: Node.js vm module is not a security boundary. It's suitable for
 * preventing accidental misuse and controlling access, but not for adversarial scenarios.
 * For untrusted code, consider Worker Threads or isolated-vm.
 */

import * as vm from 'node:vm'
import type { PluginCapability } from '@zebric/runtime-core'

export interface SandboxOptions {
  capabilities?: PluginCapability[]
  timeout?: number  // Execution timeout in milliseconds (default: 1000)
  displayErrors?: boolean
}

export interface PluginContext {
  // Input data (always available)
  data?: any

  // Safe built-ins (always available)
  JSON: typeof JSON
  Math: typeof Math
  Date: typeof Date
  Array: typeof Array
  Object: typeof Object
  String: typeof String
  Number: typeof Number
  Boolean: typeof Boolean
  console: Console

  // Capability-based APIs (only if granted)
  db?: DatabaseAPI
  fetch?: FetchAPI
  storage?: StorageAPI
  fs?: FilesystemAPI
}

export interface DatabaseAPI {
  query: (sql: string, params?: any[]) => Promise<any[]>
  findById: (entity: string, id: string) => Promise<any>
  create: (entity: string, data: any) => Promise<any>
  update: (entity: string, id: string, data: any) => Promise<any>
  delete: (entity: string, id: string) => Promise<void>
}

export interface FetchAPI {
  (url: string, options?: RequestInit): Promise<Response>
}

export interface StorageAPI {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
  delete: (key: string) => Promise<void>
  list: (prefix?: string) => Promise<string[]>
}

export interface FilesystemAPI {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  list: (directory: string) => Promise<string[]>
}

/**
 * PluginSandbox provides isolated execution environment for limited-trust plugins.
 *
 * Features:
 * - Capability-based access control (database, network, storage, filesystem)
 * - Timeout enforcement to prevent infinite loops
 * - Context isolation (plugin state doesn't affect host)
 * - Safe built-ins (Math, Date, JSON, etc.)
 *
 * Limitations:
 * - No memory limits (use Worker Threads for that)
 * - Not cryptographically secure (vm is not a security boundary)
 * - Same process (crash could affect host)
 *
 * @example
 * ```typescript
 * const sandbox = new PluginSandbox({
 *   capabilities: ['database'],
 *   timeout: 1000
 * })
 *
 * const result = await sandbox.run(`
 *   const users = await db.query('SELECT * FROM users WHERE active = ?', [true])
 *   return users.length
 * `, { db: myDatabaseClient })
 * ```
 */
export class PluginSandbox {
  private capabilities: Set<PluginCapability>
  private timeout: number
  private displayErrors: boolean

  constructor(options: SandboxOptions = {}) {
    this.capabilities = new Set(options.capabilities || [])
    this.timeout = options.timeout || 1000
    this.displayErrors = options.displayErrors !== false
  }

  /**
   * Create sandbox context with safe built-ins and requested capabilities
   */
  createContext(apis: {
    data?: any
    db?: DatabaseAPI
    fetch?: FetchAPI
    storage?: StorageAPI
    fs?: FilesystemAPI
  } = {}): PluginContext {
    const context: PluginContext = {
      // Input data
      data: apis.data,

      // Safe built-ins (always available)
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,

      // Scoped console (prefixed with [PLUGIN])
      console: {
        log: (...args: any[]) => console.log('[PLUGIN]', ...args),
        error: (...args: any[]) => console.error('[PLUGIN]', ...args),
        warn: (...args: any[]) => console.warn('[PLUGIN]', ...args),
        info: (...args: any[]) => console.info('[PLUGIN]', ...args),
        debug: (...args: any[]) => console.debug('[PLUGIN]', ...args),
      } as Console,
    }

    // Add capability-based APIs only if granted
    if (this.capabilities.has('database') && apis.db) {
      context.db = apis.db
    }

    if (this.capabilities.has('network') && apis.fetch) {
      context.fetch = apis.fetch
    }

    if (this.capabilities.has('storage') && apis.storage) {
      context.storage = apis.storage
    }

    if (this.capabilities.has('filesystem') && apis.fs) {
      context.fs = apis.fs
    }

    return context
  }

  /**
   * Run plugin code in sandbox
   *
   * @param code - Plugin code to execute
   * @param apis - APIs to inject into sandbox context
   * @returns Result of plugin execution
   * @throws {Error} If code execution fails or times out
   */
  async run(
    code: string,
    apis: {
      data?: any
      db?: DatabaseAPI
      fetch?: FetchAPI
      storage?: StorageAPI
      fs?: FilesystemAPI
    } = {}
  ): Promise<any> {
    const context = this.createContext(apis)

    try {
      // Wrap code in async function to support await
      const wrappedCode = `
        (async () => {
          ${code}
        })()
      `

      const result = vm.runInNewContext(wrappedCode, context, {
        timeout: this.timeout,
        displayErrors: this.displayErrors,
      })

      // If result is a promise, await it
      if (result && typeof result.then === 'function') {
        return await result
      }

      return result
    } catch (error: any) {
      // Re-throw with more context
      throw new Error(`Plugin execution failed: ${error.message}`, {
        cause: error,
      })
    }
  }

  /**
   * Run plugin code synchronously (no async/await support)
   *
   * @param code - Plugin code to execute
   * @param apis - APIs to inject into sandbox context
   * @returns Result of plugin execution
   * @throws {Error} If code execution fails or times out
   */
  runSync(
    code: string,
    apis: {
      data?: any
      db?: DatabaseAPI
      fetch?: FetchAPI
      storage?: StorageAPI
      fs?: FilesystemAPI
    } = {}
  ): any {
    const context = this.createContext(apis)

    try {
      return vm.runInNewContext(code, context, {
        timeout: this.timeout,
        displayErrors: this.displayErrors,
      })
    } catch (error: any) {
      throw new Error(`Plugin execution failed: ${error.message}`, {
        cause: error,
      })
    }
  }

  /**
   * Check if sandbox has a specific capability
   */
  hasCapability(capability: PluginCapability): boolean {
    return this.capabilities.has(capability)
  }

  /**
   * Get list of granted capabilities
   */
  getCapabilities(): PluginCapability[] {
    return Array.from(this.capabilities)
  }
}

/**
 * Create a sandbox with no capabilities (maximum safety)
 */
export function createSafeSandbox(timeout = 1000): PluginSandbox {
  return new PluginSandbox({ capabilities: [], timeout })
}

/**
 * Create a sandbox with database capability
 */
export function createDatabaseSandbox(timeout = 1000): PluginSandbox {
  return new PluginSandbox({ capabilities: ['database'], timeout })
}

/**
 * Create a sandbox with network capability
 */
export function createNetworkSandbox(timeout = 1000): PluginSandbox {
  return new PluginSandbox({ capabilities: ['network'], timeout })
}

/**
 * Create a sandbox with all capabilities (use with caution)
 */
export function createFullAccessSandbox(timeout = 5000): PluginSandbox {
  return new PluginSandbox({
    capabilities: ['database', 'network', 'storage', 'filesystem'],
    timeout,
  })
}
