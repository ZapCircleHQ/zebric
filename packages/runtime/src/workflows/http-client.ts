/**
 * HTTP Client for Workflow Webhooks
 *
 * Production-ready HTTP client with:
 * - Timeout handling
 * - Retry logic with exponential backoff
 * - Payload size limits
 * - Circuit breaker pattern
 * - Request/response logging
 */

import type { HttpClient } from './workflow-executor.js'

export interface HttpClientConfig {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Maximum payload size in bytes (default: 10MB) */
  maxPayloadSize?: number
  /** Number of retry attempts (default: 3) */
  retries?: number
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelay?: number
  /** Maximum retry delay in milliseconds (default: 10000) */
  maxRetryDelay?: number
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Circuit breaker threshold (failures before open) */
  circuitBreakerThreshold?: number
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetTimeout?: number
}

interface CircuitBreakerState {
  failures: number
  lastFailureTime: number
  state: 'closed' | 'open' | 'half-open'
}

export class ProductionHttpClient implements HttpClient {
  private config: Required<HttpClientConfig>
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()

  constructor(config: HttpClientConfig = {}) {
    this.config = {
      timeout: config.timeout ?? 30000,
      maxPayloadSize: config.maxPayloadSize ?? 10 * 1024 * 1024, // 10MB
      retries: config.retries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      maxRetryDelay: config.maxRetryDelay ?? 10000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetTimeout: config.circuitBreakerResetTimeout ?? 60000,
    }
  }

  /**
   * Make HTTP request with retry logic and circuit breaker
   */
  async request(
    url: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE'
      headers?: Record<string, string>
      body?: any
    }
  ): Promise<any> {
    // Validate URL
    this.validateUrl(url)

    // Check circuit breaker
    const hostname = new URL(url).hostname
    this.checkCircuitBreaker(hostname)

    // Validate payload size
    if (options.body) {
      this.validatePayloadSize(options.body)
    }

    let lastError: Error | null = null

    // Retry loop
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await this.makeRequest(url, options, attempt)

        // Success - record it for circuit breaker
        this.recordSuccess(hostname)

        return response
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Record failure for circuit breaker
        this.recordFailure(hostname)

        // Don't retry on client errors (4xx) or on last attempt
        if (this.isClientError(error) || attempt === this.config.retries) {
          break
        }

        // Calculate retry delay with exponential backoff
        const delay = Math.min(
          this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt),
          this.config.maxRetryDelay
        )

        console.warn(
          `HTTP request failed (attempt ${attempt + 1}/${this.config.retries + 1}), ` +
          `retrying in ${delay}ms:`,
          lastError.message
        )

        await this.sleep(delay)
      }
    }

    throw new Error(
      `HTTP request failed after ${this.config.retries + 1} attempts: ${lastError?.message}`
    )
  }

  /**
   * Make actual HTTP request with timeout
   */
  private async makeRequest(
    url: string,
    options: {
      method: string
      headers?: Record<string, string>
      body?: any
    },
    attempt: number
  ): Promise<any> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Zebric-Runtime/0.1.1',
        ...options.headers,
      }

      const requestOptions: RequestInit = {
        method: options.method,
        headers,
        signal: controller.signal,
      }

      if (options.body && (options.method === 'POST' || options.method === 'PUT')) {
        requestOptions.body = JSON.stringify(options.body)
      }

      console.debug(`[HTTP] ${options.method} ${url} (attempt ${attempt + 1})`)

      const response = await fetch(url, requestOptions)

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.statusText
        )
      }

      // Parse response
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        const data = await response.json()

        // Validate response size
        this.validatePayloadSize(data)

        return data
      }

      return await response.text()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Validate URL is safe
   */
  private validateUrl(url: string): void {
    try {
      const parsed = new URL(url)

      // Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid protocol: ${parsed.protocol}. Only HTTP/HTTPS allowed.`)
      }

      // Block localhost/private IPs in production (SSRF protection)
      if (process.env.NODE_ENV === 'production') {
        const hostname = parsed.hostname.toLowerCase()

        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '0.0.0.0' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)
        ) {
          throw new Error('Cannot make requests to private IP addresses or localhost in production')
        }
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`Invalid URL: ${url}`)
      }
      throw error
    }
  }

  /**
   * Validate payload size
   */
  private validatePayloadSize(data: any): void {
    const size = JSON.stringify(data).length

    if (size > this.config.maxPayloadSize) {
      throw new Error(
        `Payload size (${size} bytes) exceeds maximum allowed size (${this.config.maxPayloadSize} bytes)`
      )
    }
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(hostname: string): void {
    const breaker = this.circuitBreakers.get(hostname)

    if (!breaker) {
      return
    }

    const now = Date.now()

    if (breaker.state === 'open') {
      // Check if we should transition to half-open
      if (now - breaker.lastFailureTime >= this.config.circuitBreakerResetTimeout) {
        breaker.state = 'half-open'
        console.info(`Circuit breaker for ${hostname} transitioned to half-open`)
      } else {
        throw new Error(
          `Circuit breaker open for ${hostname}. ` +
          `Too many failures (${breaker.failures}/${this.config.circuitBreakerThreshold}). ` +
          `Will retry after ${new Date(breaker.lastFailureTime + this.config.circuitBreakerResetTimeout).toISOString()}`
        )
      }
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(hostname: string): void {
    const breaker = this.circuitBreakers.get(hostname)

    if (!breaker) {
      return
    }

    if (breaker.state === 'half-open') {
      // Success in half-open state closes the circuit
      breaker.state = 'closed'
      breaker.failures = 0
      console.info(`Circuit breaker for ${hostname} closed after successful request`)
    } else if (breaker.state === 'closed' && breaker.failures > 0) {
      // Reset failure count on success
      breaker.failures = 0
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(hostname: string): void {
    const breaker = this.circuitBreakers.get(hostname) || {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed' as const,
    }

    breaker.failures++
    breaker.lastFailureTime = Date.now()

    if (breaker.failures >= this.config.circuitBreakerThreshold) {
      breaker.state = 'open'
      console.warn(
        `Circuit breaker opened for ${hostname} after ${breaker.failures} failures. ` +
        `Will retry after ${this.config.circuitBreakerResetTimeout}ms`
      )
    }

    this.circuitBreakers.set(hostname, breaker)
  }

  /**
   * Check if error is a client error (4xx)
   */
  private isClientError(error: any): boolean {
    if (error instanceof HttpError) {
      return error.status >= 400 && error.status < 500
    }
    return false
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Reset circuit breaker for a hostname (useful for testing)
   */
  resetCircuitBreaker(hostname: string): void {
    this.circuitBreakers.delete(hostname)
  }

  /**
   * Get circuit breaker state (useful for monitoring)
   */
  getCircuitBreakerState(hostname: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(hostname)
  }
}

/**
 * Custom HTTP error with status code
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
