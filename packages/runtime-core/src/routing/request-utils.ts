/**
 * Request Utilities
 *
 * Standalone helper functions for HTTP response building,
 * cookie/flash management, and content negotiation.
 */

import type { HttpRequest, HttpResponse, FlashMessage } from './request-ports.js'

export function wantsJson(request: HttpRequest): boolean {
  const accept = request.headers.accept || ''
  if (!accept) return false
  const wantsJsonHeader = accept.includes('application/json')
  const wantsHtml = accept.includes('text/html') || accept.includes('application/xhtml+xml')
  return wantsJsonHeader && !wantsHtml
}

export function jsonResponse(status: number, data: any, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data)
  }
}

export function htmlResponse(status: number, html: string, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { 'Content-Type': 'text/html', ...headers },
    body: html
  }
}

export function redirectResponse(location: string, headers: Record<string, string> = {}): HttpResponse {
  return {
    status: 303,
    headers: { 'Location': location, ...headers },
    body: ''
  }
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [name, ...rest] = part.split('=')
    if (!name) return acc
    acc[name.trim()] = rest.join('=').trim()
    return acc
  }, {})
}

export function getFlashMessage(request: HttpRequest): FlashMessage | undefined {
  const cookieHeader = (request.headers['cookie'] as string) || (request.headers['Cookie'] as string)
  if (!cookieHeader) {
    return undefined
  }

  const cookies = parseCookies(cookieHeader)
  const raw = cookies['flash']
  if (!raw) {
    return undefined
  }

  try {
    const decoded = decodeURIComponent(raw)
    const parsed = JSON.parse(decoded)
    if (parsed && typeof parsed.text === 'string') {
      return parsed
    }
  } catch {
    return undefined
  }

  return undefined
}

export function clearFlashCookieHeader(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
}

export function getCsrfTokenFromCookies(request: HttpRequest): string | undefined {
  const injectedToken = request.headers['x-zebric-csrf-token']
  if (typeof injectedToken === 'string' && injectedToken.length > 0) {
    return injectedToken
  }
  const cookieHeader = (request.headers['cookie'] as string) || (request.headers['Cookie'] as string)
  if (!cookieHeader) {
    return undefined
  }
  const cookies = parseCookies(cookieHeader)
  return cookies['csrf-token']
}

export function extractIp(request: HttpRequest): string {
  return (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
         (request.headers['x-real-ip'] as string) ||
         'unknown'
}

export function replacePlaceholders(template: string, values: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return values[key] !== undefined ? String(values[key]) : `{${key}}`
  })
}
