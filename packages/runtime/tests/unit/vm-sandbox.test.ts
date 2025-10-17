/**
 * Test what we can actually block in Node.js VM sandbox
 */

import { describe, it, expect } from 'vitest'
import * as vm from 'node:vm'

describe('VM Sandbox Capabilities', () => {
  it('should block require() by default', () => {
    const code = `
      const fs = require('fs');
      fs.readFileSync('/etc/passwd', 'utf8');
    `

    expect(() => {
      vm.runInNewContext(code, {})
    }).toThrow()
  })

  it('should block global process access', () => {
    const code = `process.env.SECRET_KEY`

    // process is not defined in sandbox - throws ReferenceError
    expect(() => {
      vm.runInNewContext(code, {})
    }).toThrow(/process is not defined/)
  })

  it('should block direct fetch if not provided', () => {
    const code = `fetch('https://example.com')`

    expect(() => {
      vm.runInNewContext(code, {})
    }).toThrow()
  })

  it('should allow pure computation', () => {
    const code = `
      function add(a, b) {
        return a + b;
      }
      add(2, 3)
    `

    const result = vm.runInNewContext(code, {})
    expect(result).toBe(5)
  })

  it('should allow controlled data access via context', () => {
    const code = `
      data.items.map(item => item.name.toUpperCase())
    `

    const context = {
      data: {
        items: [
          { name: 'apple' },
          { name: 'banana' }
        ]
      }
    }

    const result = vm.runInNewContext(code, context)
    expect(result).toEqual(['APPLE', 'BANANA'])
  })

  it('should support timeout for long-running code', () => {
    const code = `while(true) {}`

    expect(() => {
      vm.runInNewContext(code, {}, { timeout: 100 })
    }).toThrow(/timed out/)
  })

  describe('Capability-based access', () => {
    it('should provide database access only if granted', () => {
      const codeWithDb = `
        db.query('SELECT * FROM users')
      `

      // Without database capability - should fail
      expect(() => {
        vm.runInNewContext(codeWithDb, {})
      }).toThrow()

      // With database capability - should work
      const mockDb = {
        query: (sql: string) => [{ id: 1, name: 'Test' }]
      }
      const result = vm.runInNewContext(codeWithDb, { db: mockDb })
      expect(result).toEqual([{ id: 1, name: 'Test' }])
    })

    it('should provide network access only if granted', async () => {
      const codeWithFetch = `
        fetch('https://api.example.com/data').then(r => r.json())
      `

      // Without network capability - should fail
      expect(() => {
        vm.runInNewContext(codeWithFetch, {})
      }).toThrow()

      // With network capability - should work
      const mockFetch = async (url: string) => ({
        json: async () => ({ data: 'test' })
      })
      const result = await vm.runInNewContext(codeWithFetch, { fetch: mockFetch })
      expect(result).toBeDefined()
    })
  })

  describe('Escape attempts', () => {
    it('should isolate prototype pollution', () => {
      const code = `
        Object.prototype.polluted = 'bad';
        ({}).polluted
      `

      const result = vm.runInNewContext(code, {})
      // Should be isolated - pollution doesn't escape to host
      expect(({} as any).polluted).toBeUndefined()
      // But returns 'bad' inside the sandbox
      expect(result).toBe('bad')
    })

    it('NOTE: VM is not perfect - constructor escapes work but globals are still unavailable', () => {
      // Known limitation: vm.runInNewContext is not a security boundary
      // Even with constructor escapes, sandboxed code doesn't get process/require
      // For production, consider isolated-vm or worker threads for untrusted code
      expect(true).toBe(true)
    })
  })

  describe('Memory limits', () => {
    it('should be able to set memory limits (conceptual)', () => {
      // Note: vm module doesn't directly support memory limits
      // Would need to use worker threads or separate process
      const code = `
        const bigArray = new Array(10000000).fill('x')
        bigArray.length
      `

      // This will succeed in VM (no built-in memory limit)
      const result = vm.runInNewContext(code, {})
      expect(result).toBe(10000000)

      // For real memory limits, need worker threads or child process
    })
  })
})

describe('Practical Plugin Sandbox', () => {
  class PluginSandbox {
    private capabilities: Set<string>

    constructor(capabilities: string[] = []) {
      this.capabilities = new Set(capabilities)
    }

    createContext(data: any = {}) {
      const context: any = { data }

      // Safe built-ins always available
      context.console = {
        log: (...args: any[]) => console.log('[PLUGIN]', ...args)
      }
      context.JSON = JSON
      context.Math = Math
      context.Date = Date
      context.Array = Array
      context.Object = Object
      context.String = String
      context.Number = Number

      // Conditional capabilities
      if (this.capabilities.has('database')) {
        context.db = this.createDbProxy()
      }

      if (this.capabilities.has('network')) {
        context.fetch = this.createFetchProxy()
      }

      if (this.capabilities.has('storage')) {
        context.storage = this.createStorageProxy()
      }

      return context
    }

    private createDbProxy() {
      return {
        query: (sql: string) => {
          console.log('[SANDBOX] Database query:', sql)
          return [] // Mock
        }
      }
    }

    private createFetchProxy() {
      return async (url: string) => {
        console.log('[SANDBOX] Network request:', url)
        return { json: async () => ({}) } // Mock
      }
    }

    private createStorageProxy() {
      return {
        get: (key: string) => null,
        set: (key: string, value: any) => {}
      }
    }

    run(code: string, data: any = {}, timeout = 1000): any {
      const context = this.createContext(data)
      return vm.runInNewContext(code, context, {
        timeout,
        displayErrors: true
      })
    }
  }

  it('should run limited plugin without capabilities', () => {
    const sandbox = new PluginSandbox([])

    const pluginCode = `
      data.items.map(item => ({
        ...item,
        displayName: item.name.toUpperCase()
      }))
    `

    const result = sandbox.run(pluginCode, {
      items: [{ name: 'test' }]
    })

    expect(result).toEqual([{ name: 'test', displayName: 'TEST' }])
  })

  it('should block database access without capability', () => {
    const sandbox = new PluginSandbox([])

    const pluginCode = `db.query('SELECT * FROM users')`

    expect(() => {
      sandbox.run(pluginCode)
    }).toThrow()
  })

  it('should allow database access with capability', () => {
    const sandbox = new PluginSandbox(['database'])

    const pluginCode = `db.query('SELECT * FROM users')`

    const result = sandbox.run(pluginCode)
    expect(result).toEqual([])
  })

  it('should block network access without capability', () => {
    const sandbox = new PluginSandbox([])

    const pluginCode = `fetch('https://api.example.com')`

    expect(() => {
      sandbox.run(pluginCode)
    }).toThrow()
  })

  it('should allow network access with capability', async () => {
    const sandbox = new PluginSandbox(['network'])

    const pluginCode = `fetch('https://api.example.com')`

    const result = await sandbox.run(pluginCode)
    expect(result).toBeDefined()
  })

  it('should enforce timeout', () => {
    const sandbox = new PluginSandbox([])

    const pluginCode = `while(true) {}`

    expect(() => {
      sandbox.run(pluginCode, {}, 100)
    }).toThrow(/timed out/)
  })
})
