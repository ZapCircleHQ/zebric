/**
 * Session Resolver
 *
 * Standalone functions for session retrieval, login redirect building,
 * and origin resolution.
 */

import type { Blueprint, Page } from '../types/blueprint.js'
import type { HttpRequest, SessionManagerPort } from './request-ports.js'

/**
 * Resolve the current session from the request
 */
export async function resolveSession(
  request: HttpRequest,
  sessionManager?: SessionManagerPort
): Promise<any> {
  if (!sessionManager) {
    return null
  }

  try {
    return await sessionManager.getSession(request)
  } catch (error) {
    console.error('Session retrieval error:', error)
    return null
  }
}

/**
 * Find the login page path from the blueprint
 */
export function findLoginPath(blueprint: Blueprint): string {
  const pages = blueprint?.pages || []
  const explicit = pages.find((page) => page.path.includes('sign-in') || page.path.includes('login'))
  return explicit?.path || '/auth/sign-in'
}

/**
 * Get the callback path from a request URL
 */
export function getCallbackPath(request: HttpRequest, fallbackPath: string): string {
  try {
    const url = new URL(request.url)
    const path = url.pathname + (url.search || '')
    return path.startsWith('/') ? path : `/${path}`
  } catch {
    return fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`
  }
}

/**
 * Resolve the origin (protocol + host) from a request
 */
export function resolveOrigin(request: HttpRequest, defaultOrigin: string): string {
  const fallback = new URL(defaultOrigin)
  const url = new URL(request.url)
  const protocol = url.protocol.replace(':', '') || fallback.protocol.replace(':', '') || 'http'
  const host = url.host || fallback.host || 'localhost:3000'
  return `${protocol}://${host}`
}

/**
 * Build the full login redirect URL with callback
 */
export function buildLoginRedirect(
  page: Page,
  request: HttpRequest,
  blueprint: Blueprint,
  defaultOrigin: string
): string {
  const loginPath = findLoginPath(blueprint)
  const separator = loginPath.includes('?') ? '&' : '?'
  const callbackTarget = getCallbackPath(request, page.path)
  const origin = resolveOrigin(request, defaultOrigin)
  const callback = encodeURIComponent(origin + callbackTarget)
  return `${loginPath}${separator}callbackURL=${callback}`
}
