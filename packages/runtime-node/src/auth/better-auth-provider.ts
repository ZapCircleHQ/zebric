/**
 * BetterAuth Provider Implementation
 *
 * Implements the AuthProvider interface using Better Auth.
 */

import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import type { FastifyRequest } from 'fastify'
import type { AuthProvider, UserSession } from '@zebric/runtime-core'
import type { AuthProviderConfig } from './config.js'

/**
 * BetterAuthProvider - Better Auth implementation of AuthProvider
 */
export class BetterAuthProvider implements AuthProvider {
  private auth: ReturnType<typeof betterAuth>

  constructor(config: AuthProviderConfig) {
    const { databaseUrl, blueprint, baseURL, secret, trustedOrigins } = config

    // Get auth providers from Blueprint
    const providers = blueprint.auth?.providers || ['email']

    // Configure email/password authentication
    const emailPassword = providers.includes('email')

    // Create better-sqlite3 database instance
    const db = new Database(databaseUrl)

    this.auth = betterAuth({
      database: db,
      baseURL,
      secret,
      trustedOrigins,
      emailAndPassword: emailPassword
        ? {
            enabled: true,
          }
        : undefined,
      session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60, // 5 minutes
        },
      },
      // Better Auth handles secure cookies automatically based on NODE_ENV
      advanced: {
        useSecureCookies: process.env.NODE_ENV === 'production',
      },
    })
  }

  /**
   * Get the underlying Better Auth instance
   */
  getAuthInstance(): ReturnType<typeof betterAuth> {
    return this.auth
  }

  /**
   * Get session from request
   * Note: Accepts any request type (FastifyRequest or Web API Request) for compatibility
   */
  async getSession(request: any): Promise<UserSession | null> {
    try {
      // Get session token from cookie or header
      const token = this.extractToken(request)
      if (!token) {
        return null
      }

      // Create headers object with the session token in the cookie format Better Auth expects
      const headers: Record<string, string> = { ...request.headers as Record<string, string> }

      // If token came from Bearer header, set it as a cookie for Better Auth
      if (!headers.cookie?.includes('better-auth.session_token')) {
        const existingCookies = headers.cookie || ''
        headers.cookie = existingCookies
          ? `${existingCookies}; better-auth.session_token=${token}`
          : `better-auth.session_token=${token}`
      }

      // Verify session with Better Auth
      const session = await this.auth.api.getSession({
        headers,
      })

      if (!session?.session || !session?.user) {
        return null
      }

      return {
        id: session.session.id,
        userId: session.user.id,
        user: {
          ...session.user,
        },
        expiresAt: new Date(session.session.expiresAt),
        createdAt: new Date(session.session.createdAt),
      }
    } catch (error) {
      console.error('Session retrieval error:', error)
      return null
    }
  }

  /**
   * Extract authentication token from request
   */
  private extractToken(request: FastifyRequest): string | null {
    // Check Authorization header
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7)
    }

    const zblHeader = (request.headers as Record<string, string | string[] | undefined>)['zbl-token']
    if (typeof zblHeader === 'string' && zblHeader.trim()) {
      return zblHeader.trim()
    }

    const apiHeader = (request.headers as Record<string, string | string[] | undefined>)['x-api-token']
    if (typeof apiHeader === 'string' && apiHeader.trim()) {
      return apiHeader.trim()
    }

    // Check cookies
    const sessionCookie = request.cookies?.['better-auth.session_token']
    if (sessionCookie) {
      return sessionCookie
    }

    return null
  }

  /**
   * Check if user has required role
   */
  hasRole(session: UserSession | null, role: string): boolean {
    if (!session) return false
    return session.user.role === role
  }

  /**
   * Check if user owns a resource
   */
  ownsResource(session: UserSession | null, resourceUserId: string): boolean {
    if (!session) return false
    return session.userId === resourceUserId
  }

  /**
   * Cleanup (Better Auth doesn't require explicit cleanup)
   */
  async cleanup(): Promise<void> {
    // No cleanup needed for Better Auth
  }
}
