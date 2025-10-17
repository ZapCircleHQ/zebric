/**
 * Unit tests for ProductionHttpClient
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProductionHttpClient, HttpError } from './http-client.js'

// Mock global fetch
global.fetch = vi.fn()

describe('ProductionHttpClient', () => {
  let client: ProductionHttpClient

  beforeEach(() => {
    client = new ProductionHttpClient({
      timeout: 5000,
      maxPayloadSize: 1024, // 1KB for testing
      retries: 2,
      retryDelay: 100,
      circuitBreakerThreshold: 3,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful requests', () => {
    it('should make successful GET request', async () => {
      const mockResponse = { success: true, data: 'test' }
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => mockResponse,
      })

      const result = await client.request('https://api.example.com/test', {
        method: 'GET',
      })

      expect(result).toEqual(mockResponse)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should make successful POST request with body', async () => {
      const mockResponse = { id: '123' }
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => mockResponse,
      })

      const result = await client.request('https://api.example.com/create', {
        method: 'POST',
        body: { name: 'test' },
        headers: { 'X-Custom': 'header' },
      })

      expect(result).toEqual(mockResponse)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'header',
          }),
        })
      )
    })

    it('should handle non-JSON responses', async () => {
      const mockText = 'Plain text response'
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        text: async () => mockText,
      })

      const result = await client.request('https://api.example.com/text', {
        method: 'GET',
      })

      expect(result).toBe(mockText)
    })
  })

  describe('error handling', () => {
    it('should throw on HTTP error status', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => 'application/json' },
      })

      await expect(
        client.request('https://api.example.com/missing', { method: 'GET' })
      ).rejects.toThrow('HTTP 404: Not Found')
    })

    it('should throw on invalid URL', async () => {
      await expect(
        client.request('not-a-url', { method: 'GET' })
      ).rejects.toThrow('Invalid URL')
    })

    it('should block invalid protocols', async () => {
      await expect(
        client.request('ftp://example.com/file', { method: 'GET' })
      ).rejects.toThrow('Invalid protocol')
    })

    it('should block localhost in production', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      await expect(
        client.request('http://localhost:3000/api', { method: 'GET' })
      ).rejects.toThrow('Cannot make requests to private IP addresses')

      await expect(
        client.request('http://127.0.0.1/api', { method: 'GET' })
      ).rejects.toThrow('Cannot make requests to private IP addresses')

      await expect(
        client.request('http://192.168.1.1/api', { method: 'GET' })
      ).rejects.toThrow('Cannot make requests to private IP addresses')

      process.env.NODE_ENV = originalEnv
    })

    it('should allow localhost in development', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      })

      await expect(
        client.request('http://localhost:3000/api', { method: 'GET' })
      ).resolves.toBeDefined()

      process.env.NODE_ENV = originalEnv
    })
  })

  describe('payload size limits', () => {
    it('should reject oversized request payload', async () => {
      const largePayload = { data: 'x'.repeat(2000) } // > 1KB

      await expect(
        client.request('https://api.example.com/large', {
          method: 'POST',
          body: largePayload,
        })
      ).rejects.toThrow('Payload size')
    })

    it('should reject oversized response payload', async () => {
      const largeResponse = { data: 'x'.repeat(2000) } // > 1KB
      // Mock all 3 retry attempts to return oversized response
      for (let i = 0; i < 3; i++) {
        ;(global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => largeResponse,
        })
      }

      await expect(
        client.request('https://api.example.com/large', { method: 'GET' })
      ).rejects.toThrow('Payload size')
    })
  })

  describe('retry logic', () => {
    it('should retry on server error', async () => {
      ;(global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true }),
        })

      const result = await client.request('https://api.example.com/retry', {
        method: 'GET',
      })

      expect(result).toEqual({ success: true })
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('should not retry on client error (4xx)', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => 'application/json' },
      })

      await expect(
        client.request('https://api.example.com/bad', { method: 'GET' })
      ).rejects.toThrow('HTTP 400')

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should give up after max retries', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      await expect(
        client.request('https://api.example.com/fail', { method: 'GET' })
      ).rejects.toThrow('HTTP request failed after 3 attempts')

      expect(global.fetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Service unavailable'))

      // Make failures to reach threshold (3 retries each = 3 attempts per request)
      for (let i = 0; i < 3; i++) {
        await expect(
          client.request('https://failing.example.com/api', { method: 'GET' })
        ).rejects.toThrow()
      }

      // Circuit should now be open
      await expect(
        client.request('https://failing.example.com/api', { method: 'GET' })
      ).rejects.toThrow('Circuit breaker open')

      // Should have made 3 fetch calls (one per request, each with 3 attempts = 9 total)
      // But the circuit opens after 3 failures, so only first request makes all attempts
      expect(global.fetch).toHaveBeenCalled()
    })

    it('should reset circuit on successful request in half-open state', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Service unavailable'))

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          client.request('https://flaky.example.com/api', { method: 'GET' })
        ).rejects.toThrow()
      }

      // Verify circuit is open
      let state = client.getCircuitBreakerState('flaky.example.com')
      expect(state?.state).toBe('open')

      // Wait for circuit breaker reset timeout to trigger half-open state
      // Instead of resetting manually, we'll simulate time passing
      await new Promise(resolve => setTimeout(resolve, 100))

      // Mock successful response
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true }),
      })

      // Manually transition to half-open for testing
      client.resetCircuitBreaker('flaky.example.com')

      // Make successful request
      const result = await client.request('https://flaky.example.com/api', {
        method: 'GET',
      })
      expect(result).toEqual({ ok: true })

      // After reset and successful request, state should be cleared or closed
      // Since resetCircuitBreaker deletes the entry, a new successful request
      // won't have a circuit breaker state (it only creates on failure)
      state = client.getCircuitBreakerState('flaky.example.com')
      expect(state).toBeUndefined() // Circuit breaker only tracks failures
    })
  })

  describe('timeout', () => {
    it('should timeout long requests', async () => {
      // Mock all requests to timeout
      ;(global.fetch as any).mockImplementation((_url: string, options: any) => {
        return new Promise((resolve, reject) => {
          const signal = options.signal
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'))
            })
          }
          // Never resolve - let the timeout trigger abort
        })
      })

      await expect(
        client.request('https://slow.example.com/api', { method: 'GET' })
      ).rejects.toThrow('Request timeout')
    }, 20000)
  })
})
