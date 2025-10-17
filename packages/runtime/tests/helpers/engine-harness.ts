import { ZebricEngine } from '../../src/engine.js'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

/**
 * Engine Test Harness
 *
 * Provides reusable utilities for integration tests:
 * - Dynamic port allocation (prevents conflicts)
 * - Temporary directory management
 * - Blueprint file creation
 * - Engine lifecycle management
 * - HTTP request helpers
 */
export class EngineTestHarness {
  private engine: ZebricEngine | null = null
  private tempDir: string | null = null
  private port: number | null = null
  private baseUrl: string | null = null

  /**
   * Get an available port dynamically
   * Uses OS to find free port, preventing test conflicts
   */
  async getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.unref()
      server.on('error', reject)
      server.listen(0, () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          const port = address.port
          server.close(() => resolve(port))
        } else {
          reject(new Error('Unable to get port'))
        }
      })
    })
  }

  /**
   * Create a temporary directory for test isolation
   * Each test gets its own temp dir with database
   */
  async createTempDir(): Promise<string> {
    const tempDir = await mkdtemp(join(tmpdir(), 'zbl-test-'))
    this.tempDir = tempDir
    return tempDir
  }

  /**
   * Write a blueprint file to the temp directory
   */
  async writeBlueprint(blueprint: any): Promise<string> {
    if (!this.tempDir) {
      throw new Error('Temp directory not created. Call createTempDir() first.')
    }

    const blueprintPath = join(this.tempDir, 'blueprint.json')
    await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2))
    return blueprintPath
  }

  /**
   * Write a blueprint file (TOML or JSON string) to the temp directory
   */
  async writeBlueprintFile(content: string): Promise<string> {
    if (!this.tempDir) {
      throw new Error('Temp directory not created. Call createTempDir() first.')
    }

    // Detect format based on content
    const isToml = content.trim().startsWith('[') || content.includes('version =')
    const filename = isToml ? 'blueprint.toml' : 'blueprint.json'
    const blueprintPath = join(this.tempDir, filename)

    await writeFile(blueprintPath, content)
    return blueprintPath
  }

  /**
   * Start the ZBL engine with the given configuration
   *
   * @param blueprintPath Path to blueprint file
   * @param options Additional engine options
   * @returns The running engine instance
   */
  async startEngine(
    blueprintPath: string,
    options: {
      port?: number
      enableAuth?: boolean
      enablePlugins?: boolean
      dbPath?: string
    } = {}
  ): Promise<ZebricEngine> {
    // Get available port if not provided
    this.port = options.port ?? (await this.getAvailablePort())
    this.baseUrl = `http://localhost:${this.port}`

    // Create database path
    const dbPath = options.dbPath ?? join(this.tempDir!, 'test.db')

    // Initialize engine
    this.engine = new ZebricEngine({
      blueprintPath,
      port: this.port,
      database: {
        type: 'sqlite',
        filename: dbPath,
      },
      dev: {
        adminPort: 0, // Use random port to avoid conflicts in tests
      },
    } as any)

    // Start engine
    await this.engine.start()

    // Wait for server to be ready
    await this.waitForServer()

    return this.engine
  }

  /**
   * Stop the engine and cleanup resources
   */
  async stopEngine(): Promise<void> {
    if (this.engine) {
      await this.engine.stop()
      this.engine = null
    }
  }

  /**
   * Cleanup temporary directory
   */
  async cleanup(): Promise<void> {
    await this.stopEngine()

    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true })
      this.tempDir = null
    }

    this.port = null
    this.baseUrl = null
  }

  /**
   * Wait for the server to be ready by polling the health endpoint
   */
  private async waitForServer(maxAttempts = 30, delayMs = 100): Promise<void> {
    if (!this.baseUrl) {
      throw new Error('Base URL not set. Call startEngine() first.')
    }

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.baseUrl}/health`)
        if (response.ok) {
          return
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    throw new Error(`Server failed to start after ${maxAttempts * delayMs}ms`)
  }

  /**
   * Make an HTTP request to the engine
   */
  async request(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.baseUrl) {
      throw new Error('Engine not started. Call startEngine() first.')
    }

    const url = `${this.baseUrl}${path}`
    return fetch(url, options)
  }

  /**
   * Make a GET request
   */
  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.request(path, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    })
  }

  /**
   * Make a POST request
   */
  async post(
    path: string,
    body: any,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    return this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }

  /**
   * Make a PUT request
   */
  async put(
    path: string,
    body: any,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    return this.request(path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }

  /**
   * Make a DELETE request
   */
  async delete(
    path: string,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    return this.request(path, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    })
  }

  /**
   * Get the engine instance (for direct access)
   */
  getEngine(): ZebricEngine {
    if (!this.engine) {
      throw new Error('Engine not started. Call startEngine() first.')
    }
    return this.engine
  }

  /**
   * Get the base URL of the running server
   */
  getBaseUrl(): string {
    if (!this.baseUrl) {
      throw new Error('Engine not started. Call startEngine() first.')
    }
    return this.baseUrl
  }

  /**
   * Get the port of the running server
   */
  getPort(): number {
    if (!this.port) {
      throw new Error('Engine not started. Call startEngine() first.')
    }
    return this.port
  }

  /**
   * Get the temporary directory path
   */
  getTempDir(): string {
    if (!this.tempDir) {
      throw new Error('Temp directory not created. Call createTempDir() first.')
    }
    return this.tempDir
  }
}

/**
 * Create a new test harness instance
 * Convenience function for tests
 */
export function createTestHarness(): EngineTestHarness {
  return new EngineTestHarness()
}
