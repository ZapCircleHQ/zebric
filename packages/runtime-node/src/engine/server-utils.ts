import type { Context } from 'hono'
import path from 'node:path'

export async function parseActionRequestBody(c: Context): Promise<Record<string, any>> {
  const contentType = c.req.header('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      const parsed = await c.req.json<Record<string, any>>()
      return normalizeActionBody(parsed)
    } catch {
      return {}
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const body = await c.req.parseBody()
      return normalizeActionBody(body as Record<string, any>)
    } catch {
      return {}
    }
  }

  return {}
}

export function normalizeActionBody(body: Record<string, any>): Record<string, any> {
  if (!body || typeof body !== 'object') return {}
  // Pass values through as-is. JSON bodies need no decoding, and
  // form-encoded bodies are already decoded by the framework.
  // Decoding HTML entities here would re-introduce XSS vectors
  // (e.g. &lt;script&gt; → <script>) if values reach templates.
  return { ...body }
}

export function parseActionPayload(value: unknown): any {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  return value
}

export async function tryParseBody(request: Request): Promise<any> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return request.json().catch(() => null)
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    return Object.fromEntries(form as any)
  }
  return request.text()
}

export function resolveActionRedirect(provided?: string, referer?: string): string {
  if (provided && isSafeRedirect(provided)) {
    return provided
  }
  if (referer && isSafeRedirect(referer)) {
    return referer
  }
  return '/'
}

export function isSafeRedirect(url: string): boolean {
  if (!url || url.length === 0) return false
  // Must be a relative path starting with a single slash.
  // Reject protocol-relative URLs (//evil.com), absolute URLs
  // (http://evil.com), and dangerous schemes (javascript:, data:).
  return url.startsWith('/') && !url.startsWith('//') && !url.includes('://')
}

export function setFlashMessage(c: Context, message: string | undefined, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
  if (!message) {
    return
  }
  const payload = encodeURIComponent(JSON.stringify({ type, text: message }))
  c.header('Set-Cookie', `flash=${payload}; Path=/; HttpOnly; SameSite=Lax`)
}

export function getCallbackPath(request: Request): string {
  const url = new URL(request.url)
  const raw = url.searchParams.get('callback') || url.searchParams.get('redirect') || '/'
  try {
    const parsed = new URL(raw, 'http://localhost')
    const p = parsed.pathname + (parsed.search || '')
    return p.startsWith('/') ? p : `/${p}`
  } catch {
    return raw && raw.startsWith('/') ? raw : '/'
  }
}

export function acceptsJson(c: Context): boolean {
  const accept = c.req.header('accept') || ''
  return accept.includes('application/json')
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }

  return mimeTypes[ext] || 'application/octet-stream'
}

export function resolveOrigin(request: Request, config: { host?: string; port?: number }): string {
  const url = new URL(request.url)
  let host = url.host

  if (!host || host.startsWith('0.0.0.0') || host.startsWith('::')) {
    const fallbackHost = config.host && config.host !== '0.0.0.0' && config.host !== '::'
      ? config.host
      : 'localhost'
    const fallbackPort = config.port || 3000
    host = `${fallbackHost}:${fallbackPort}`
  }

  return `${url.protocol}//${host}`
}

export function isUrlVerificationRequest(body: any): boolean {
  return Boolean(body && typeof body === 'object' && body.type === 'url_verification')
}
