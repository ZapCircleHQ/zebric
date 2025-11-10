/**
 * Workers CSRF Protection
 *
 * Provides CSRF token generation and validation for CloudFlare Workers.
 * Tokens are stored in session data and validated on mutating requests.
 */

import type { WorkersSessionManager } from '../session/session-manager.js'
import { WorkersCookieManager } from '../session/cookie-manager.js'

export interface CSRFProtectionConfig {
  sessionManager: WorkersSessionManager
  cookieName?: string
  headerName?: string
  formFieldName?: string
}

export class WorkersCSRFProtection {
  private sessionManager: WorkersSessionManager
  private cookieName: string
  private headerName: string
  private formFieldName: string

  constructor(config: CSRFProtectionConfig) {
    this.sessionManager = config.sessionManager
    this.cookieName = config.cookieName || 'csrf-token'
    this.headerName = config.headerName || 'x-csrf-token'
    this.formFieldName = config.formFieldName || '_csrf'
  }

  /**
   * Generate a CSRF token for a session
   * The token is stored in the session, so we just need to retrieve it
   */
  async getToken(sessionId: string): Promise<string | null> {
    return this.sessionManager.getCSRFToken(sessionId)
  }

  /**
   * Validate CSRF token from request
   */
  async validate(request: Request, sessionId: string): Promise<boolean> {
    // Only validate on mutating methods
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true
    }

    // Get expected token from session
    const expectedToken = await this.sessionManager.getCSRFToken(sessionId)
    if (!expectedToken) {
      return false
    }

    // Try to get submitted token from multiple sources
    let submittedToken: string | null | undefined = null

    // 1. Check header
    submittedToken = request.headers.get(this.headerName) || undefined

    // 2. Check cookie (for double-submit pattern)
    if (!submittedToken) {
      submittedToken = WorkersCookieManager.get(request, this.cookieName)
    }

    // 3. Check form body (if form data)
    if (!submittedToken) {
      const contentType = request.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        try {
          // Clone request to avoid consuming body
          const clonedRequest = request.clone()
          const formData = await clonedRequest.formData()
          submittedToken = formData.get(this.formFieldName) as string | null
        } catch {
          // If formData parsing fails, continue
        }
      }
    }

    // Validate token
    if (!submittedToken) {
      return false
    }

    // Constant-time comparison to prevent timing attacks
    return this.constantTimeCompare(submittedToken, expectedToken)
  }

  /**
   * Create CSRF cookie for response
   */
  createCSRFCookie(token: string): string {
    return WorkersCookieManager.serialize(this.cookieName, token, {
      httpOnly: false, // Client needs to read this for AJAX requests
      secure: true,
      sameSite: 'strict',
      path: '/'
    })
  }

  /**
   * Add CSRF token to response headers
   */
  addTokenToResponse(response: Response, token: string): Response {
    const cookieValue = this.createCSRFCookie(token)
    const newHeaders = new Headers(response.headers)
    newHeaders.append('Set-Cookie', cookieValue)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }

    return result === 0
  }

  /**
   * Middleware-style validator
   * Returns null if valid, or an error Response if invalid
   */
  async validateOrReject(request: Request, sessionId: string | null): Promise<Response | null> {
    // Skip validation for safe methods
    const method = request.method.toUpperCase()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return null
    }

    // Require session for mutating requests
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    // Validate CSRF token
    const isValid = await this.validate(request, sessionId)
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Invalid CSRF token' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    return null
  }
}
