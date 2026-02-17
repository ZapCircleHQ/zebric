import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { randomUUID } from 'node:crypto'
import type { Blueprint } from '@zebric/runtime-core'

export function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  const socket = (c.env as any)?.incoming?.socket
  return socket?.remoteAddress || 'unknown'
}

export function applyRateLimiting(
  c: Context,
  rateLimitStore: Map<string, { count: number; resetAt: number }>,
  config: { max?: number; windowMs?: number }
): Response | void {
  const ip = getClientIp(c)
  const max = config.max || 100
  const windowMs = config.windowMs || 60_000
  const now = Date.now()
  const bucket = rateLimitStore.get(ip)

  if (!bucket || now > bucket.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs })
    return
  }

  if (bucket.count >= max) {
    return Response.json(
      { error: 'Too Many Requests', retryAfter: Math.ceil((bucket.resetAt - now) / 1000) },
      { status: 429 }
    )
  }

  bucket.count += 1
}

export async function extractCsrfToken(c: Context): Promise<string | undefined> {
  const urlToken = new URL(c.req.url).searchParams.get('_csrf')
  if (urlToken) {
    return urlToken
  }

  const contentType = c.req.header('content-type') || ''

  try {
    if (contentType.includes('application/json')) {
      const cloned = c.req.raw.clone()
      const body = await cloned.json().catch(() => undefined) as Record<string, any> | undefined
      if (body && typeof body._csrf === 'string') {
        return body._csrf
      }
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const cloned = c.req.raw.clone()
      const form = await cloned.formData()
      const value = form.get('_csrf')
      if (typeof value === 'string') {
        return value
      }
      if (value && typeof value === 'object' && 'toString' in value) {
        return value.toString()
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

export function normalizeCsrfToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export async function applyCsrfProtection(
  c: Context,
  csrfCookieName: string,
  apiKeys: Map<string, { name: string }>,
  devConfig?: { logLevel?: string }
): Promise<Response | void> {
  const pathname = new URL(c.req.url).pathname
  const isInboundEndpoint =
    pathname.startsWith('/webhooks/')
    || pathname.startsWith('/notifications/')
  if (isInboundEndpoint) {
    return
  }

  const method = c.req.method.toUpperCase()

  // Only skip CSRF for bearer tokens that resolve to a valid API key.
  // A garbage bearer token must NOT bypass CSRF, since skill routes fall
  // back to cookie-based session auth when the token is unrecognized.
  const authHeader = c.req.header('authorization') || ''
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7)
    if (apiKeys.has(token)) return
  }

  const isSafeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
  const existingTokenRaw = getCookie(c, csrfCookieName)
  const existingToken = normalizeCsrfToken(existingTokenRaw)

  if (isSafeMethod) {
    const token = existingToken || randomUUID()
    Reflect.set(c.req.raw, '__zebricCsrfToken', token)
    if (!existingTokenRaw) {
      setCookie(c, csrfCookieName, token, {
        httpOnly: false,
        sameSite: 'strict',
        secure: false,
        path: '/'
      })
    }
    return
  }

  let submittedToken =
    c.req.raw.headers.get('x-csrf-token')
    || c.req.raw.headers.get('X-CSRF-Token')
    || c.req.header('x-csrf-token')
    || undefined
  if (!submittedToken) {
    submittedToken = await extractCsrfToken(c)
  }
  submittedToken = normalizeCsrfToken(submittedToken)

  if (!existingToken || !submittedToken || existingToken !== submittedToken) {
    const diagnostics = devConfig?.logLevel === 'debug'
      ? {
          method,
          path: new URL(c.req.url).pathname,
          hasCookieToken: Boolean(existingToken),
          hasSubmittedToken: Boolean(submittedToken),
          cookieTokenPreview: existingToken ? existingToken.slice(0, 8) : null,
          submittedTokenPreview: submittedToken ? submittedToken.slice(0, 8) : null
        }
      : undefined
    return Response.json(
      { error: 'Invalid CSRF token', diagnostics },
      { status: 403 }
    )
  }
}

export function applySecurityHeaders(c: Context, requestId: string, traceId: string): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:"
  ].join('; ')

  c.header('X-Request-ID', requestId)
  c.header('X-Trace-ID', traceId)
  c.header('Content-Security-Policy', csp)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('X-XSS-Protection', '1; mode=block')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
}

export function initApiKeys(blueprint: Blueprint): Map<string, { name: string }> {
  const apiKeys = new Map<string, { name: string }>()
  const apiKeyConfigs = blueprint.auth?.apiKeys
  if (!apiKeyConfigs || apiKeyConfigs.length === 0) return apiKeys

  for (const keyConfig of apiKeyConfigs) {
    const keyValue = process.env[keyConfig.keyEnv]
    if (!keyValue) {
      console.warn(`API key "${keyConfig.name}": env var ${keyConfig.keyEnv} is not set, skipping`)
      continue
    }
    apiKeys.set(keyValue, { name: keyConfig.name })
  }

  return apiKeys
}

export function resolveApiKeySession(bearerToken: string, apiKeys: Map<string, { name: string }>): any | null {
  const keyConfig = apiKeys.get(bearerToken)
  if (!keyConfig) return null
  return {
    id: `apikey-${keyConfig.name}`,
    userId: keyConfig.name,
    user: { id: keyConfig.name, name: keyConfig.name, email: '' },
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  }
}
