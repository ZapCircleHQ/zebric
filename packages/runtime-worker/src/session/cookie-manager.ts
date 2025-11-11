/**
 * Workers Cookie Manager
 *
 * Utility for parsing and serializing cookies in CloudFlare Workers.
 * Wraps the 'cookie' npm package to provide a simple interface.
 */

import cookie from 'cookie'

export interface WorkersCookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  maxAge?: number
  expires?: Date
  path?: string
  domain?: string
}

export class WorkersCookieManager {
  /**
   * Parse cookies from request headers
   */
  static parse(request: Request): Record<string, string> {
    const cookieHeader = request.headers.get('cookie')
    if (!cookieHeader) {
      return {}
    }
    return cookie.parse(cookieHeader) as Record<string, string>
  }

  /**
   * Get a specific cookie value
   */
  static get(request: Request, name: string): string | undefined {
    const cookies = this.parse(request)
    return cookies[name]
  }

  /**
   * Serialize a cookie for Set-Cookie header
   */
  static serialize(name: string, value: string, options: WorkersCookieOptions = {}): string {
    // Default to secure settings
    const defaultOptions: WorkersCookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      ...options
    }

    return cookie.serialize(name, value, defaultOptions)
  }

  /**
   * Create a session cookie (expires when browser closes)
   */
  static createSessionCookie(name: string, value: string, options: Omit<WorkersCookieOptions, 'maxAge' | 'expires'> = {}): string {
    return this.serialize(name, value, {
      ...options,
      // No maxAge or expires = session cookie
    })
  }

  /**
   * Create a persistent cookie with maxAge
   */
  static createPersistentCookie(name: string, value: string, maxAgeSeconds: number, options: Omit<WorkersCookieOptions, 'maxAge'> = {}): string {
    return this.serialize(name, value, {
      ...options,
      maxAge: maxAgeSeconds
    })
  }

  /**
   * Create a cookie that expires immediately (for logout)
   */
  static createExpiredCookie(name: string, options: Omit<WorkersCookieOptions, 'maxAge' | 'expires'> = {}): string {
    return this.serialize(name, '', {
      ...options,
      maxAge: 0
    })
  }

  /**
   * Set a cookie on a response
   */
  static setCookie(response: Response, name: string, value: string, options: WorkersCookieOptions = {}): Response {
    const cookieValue = this.serialize(name, value, options)
    const newHeaders = new Headers(response.headers)
    newHeaders.append('Set-Cookie', cookieValue)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }

  /**
   * Set multiple cookies on a response
   */
  static setCookies(response: Response, cookies: Array<{ name: string; value: string; options?: WorkersCookieOptions }>): Response {
    const newHeaders = new Headers(response.headers)

    for (const { name, value, options = {} } of cookies) {
      const cookieValue = this.serialize(name, value, options)
      newHeaders.append('Set-Cookie', cookieValue)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }

  /**
   * Delete a cookie from response
   */
  static deleteCookie(response: Response, name: string, options: Omit<WorkersCookieOptions, 'maxAge' | 'expires'> = {}): Response {
    const cookieValue = this.createExpiredCookie(name, options)
    const newHeaders = new Headers(response.headers)
    newHeaders.append('Set-Cookie', cookieValue)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    })
  }
}
