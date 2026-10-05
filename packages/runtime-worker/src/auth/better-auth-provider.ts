/** Better Auth provider backed directly by a Cloudflare D1 binding. */

import { betterAuth, type Auth } from 'better-auth'
import type {
  AuthProvider,
  Blueprint,
  HttpRequest,
  UserSession,
} from '@zebric/runtime-core'

export interface WorkersBetterAuthProviderConfig {
  database: D1Database
  blueprint: Blueprint
  baseURL: string
  secret: string
  trustedOrigins?: string[]
}

export class WorkersBetterAuthProvider implements AuthProvider {
  private auth: Auth<any>

  constructor(config: WorkersBetterAuthProviderConfig) {
    const providers = config.blueprint.auth?.providers ?? ['email']
    const duration = config.blueprint.auth?.session?.duration ?? 60 * 60 * 24 * 7

    this.auth = betterAuth({
      // Better Auth 1.5+ detects D1 bindings and uses its D1 Kysely dialect.
      database: config.database,
      baseURL: config.baseURL,
      secret: config.secret,
      trustedOrigins: Array.from(new Set([
        config.baseURL,
        ...(config.trustedOrigins ?? config.blueprint.auth?.trustedOrigins ?? []),
      ])),
      emailAndPassword: providers.includes('email') ? { enabled: true } : undefined,
      user: {
        additionalFields: {
          role: {
            type: 'string',
            required: false,
            defaultValue: 'user',
            input: false,
          },
        },
      },
      session: {
        expiresIn: duration,
        updateAge: Math.min(60 * 60 * 24, duration),
        cookieCache: { enabled: true, maxAge: 5 * 60 },
      },
      advanced: {
        useSecureCookies: new URL(config.baseURL).protocol === 'https:',
      },
    })
  }

  getAuthInstance(): Auth<any> {
    return this.auth
  }

  async getSession(request: Request | HttpRequest): Promise<UserSession | null> {
    try {
      const headers = this.toHeaders(request)
      const bearer = headers.get('authorization')
      if (bearer?.toLowerCase().startsWith('bearer ')) {
        const token = bearer.slice(7).trim()
        const existing = headers.get('cookie')
        headers.set('cookie', `${existing ? `${existing}; ` : ''}better-auth.session_token=${encodeURIComponent(token)}`)
      }

      const result = await this.auth.api.getSession({ headers })
      if (!result?.session || !result.user) return null

      return {
        id: result.session.id,
        userId: result.user.id,
        user: { ...result.user },
        expiresAt: new Date(result.session.expiresAt),
        createdAt: new Date(result.session.createdAt),
      }
    } catch (error) {
      console.error('Session retrieval error:', error)
      return null
    }
  }

  hasRole(session: UserSession | null, role: string): boolean {
    if (!session) return false
    const roles = session.actor?.roles ?? session.user.roles
    return session.user.role === role || (Array.isArray(roles) && roles.includes(role))
  }

  ownsResource(session: UserSession | null, resourceUserId: string): boolean {
    return Boolean(session && session.userId === resourceUserId)
  }

  private toHeaders(request: Request | HttpRequest): Headers {
    if (request instanceof Request) return new Headers(request.headers)
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    return headers
  }
}

export function createWorkersBetterAuthProvider(config: WorkersBetterAuthProviderConfig): WorkersBetterAuthProvider {
  return new WorkersBetterAuthProvider(config)
}
