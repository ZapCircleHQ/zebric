/**
 * Workers Session Manager
 *
 * Manages user sessions using CloudFlare Workers KV storage.
 * Provides session creation, retrieval, and destruction.
 */

import type { UserSession } from '@zebric/runtime-core'
import type { SessionManagerPort } from '@zebric/runtime-core'
import type { HttpRequest } from '@zebric/runtime-core'
import { WorkersCookieManager } from './cookie-manager.js'

export interface WorkersSessionManagerConfig {
  kv: KVNamespace
  sessionCookieName?: string
  sessionTTL?: number // in seconds, default 24 hours
}

interface StoredSession {
  userId: string
  user: any
  csrfToken: string
  createdAt: number
  expiresAt: number
}

export class WorkersSessionManager implements SessionManagerPort {
  private kv: KVNamespace
  private sessionCookieName: string
  private sessionTTL: number

  constructor(config: WorkersSessionManagerConfig) {
    this.kv = config.kv
    this.sessionCookieName = config.sessionCookieName || 'session'
    this.sessionTTL = config.sessionTTL || 86400 // 24 hours default
  }

  /**
   * Get session from request (implements SessionManagerPort)
   */
  async getSession(request: HttpRequest): Promise<UserSession | null> {
    // Extract session ID from cookie
    // Note: request is HttpRequest, not native Request, so we need to parse headers
    const cookieHeader = request.headers['cookie'] as string | undefined
    if (!cookieHeader) {
      return null
    }

    // Parse cookie header manually
    const cookies: Record<string, string> = {}
    cookieHeader.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=')
      if (key && value) {
        cookies[key] = decodeURIComponent(value)
      }
    })

    const sessionId = cookies[this.sessionCookieName]
    if (!sessionId) {
      return null
    }

    return this.getSessionById(sessionId)
  }

  /**
   * Get session by ID from KV storage
   */
  async getSessionById(sessionId: string): Promise<UserSession | null> {
    const data = await this.kv.get(`session:${sessionId}`)
    if (!data) {
      return null
    }

    const stored: StoredSession = JSON.parse(data)

    // Check if expired
    if (stored.expiresAt < Date.now()) {
      await this.kv.delete(`session:${sessionId}`)
      return null
    }

    // Convert to UserSession format
    return {
      id: sessionId,
      userId: stored.userId,
      user: stored.user,
      expiresAt: new Date(stored.expiresAt),
      createdAt: new Date(stored.createdAt)
    }
  }

  /**
   * Create a new session
   */
  async createSession(userId: string, user: any): Promise<{ sessionId: string; csrfToken: string }> {
    const sessionId = crypto.randomUUID()
    const csrfToken = crypto.randomUUID()

    const stored: StoredSession = {
      userId,
      user,
      csrfToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTTL * 1000
    }

    // Store in KV with auto-expiration
    await this.kv.put(
      `session:${sessionId}`,
      JSON.stringify(stored),
      { expirationTtl: this.sessionTTL }
    )

    return { sessionId, csrfToken }
  }

  /**
   * Update session data
   */
  async updateSession(sessionId: string, updates: Partial<Pick<StoredSession, 'user' | 'csrfToken'>>): Promise<void> {
    const data = await this.kv.get(`session:${sessionId}`)
    if (!data) {
      throw new Error('Session not found')
    }

    const stored: StoredSession = JSON.parse(data)
    const updated: StoredSession = {
      ...stored,
      ...updates
    }

    await this.kv.put(
      `session:${sessionId}`,
      JSON.stringify(updated),
      { expirationTtl: this.sessionTTL }
    )
  }

  /**
   * Destroy a session
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.kv.delete(`session:${sessionId}`)
  }

  /**
   * Get CSRF token for a session
   */
  async getCSRFToken(sessionId: string): Promise<string | null> {
    const data = await this.kv.get(`session:${sessionId}`)
    if (!data) {
      return null
    }

    const stored: StoredSession = JSON.parse(data)
    return stored.csrfToken
  }

  /**
   * Regenerate CSRF token for a session
   */
  async regenerateCSRFToken(sessionId: string): Promise<string> {
    const csrfToken = crypto.randomUUID()
    await this.updateSession(sessionId, { csrfToken })
    return csrfToken
  }

  /**
   * Helper: Create session cookie
   */
  createSessionCookie(sessionId: string): string {
    return WorkersCookieManager.createPersistentCookie(
      this.sessionCookieName,
      sessionId,
      this.sessionTTL,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/'
      }
    )
  }

  /**
   * Helper: Create logout cookie (expires immediately)
   */
  createLogoutCookie(): string {
    return WorkersCookieManager.createExpiredCookie(this.sessionCookieName, {
      path: '/'
    })
  }
}
