/**
 * Route Matcher
 *
 * Matches incoming HTTP requests to Blueprint page definitions.
 * Handles static and dynamic routes with parameter extraction.
 */

import type { Page } from '@zebric/runtime-core'

export interface RouteMatch {
  page: Page
  params: Record<string, string>
  query: Record<string, string>
}

export class RouteMatcher {
  /**
   * Match a URL path to a page definition
   */
  match(path: string, pages: Page[]): RouteMatch | null {
    // Remove query string
    const [pathname, queryString] = path.split('?')
    const query = this.parseQueryString(queryString || '')

    // Try exact match first (faster)
    for (const page of pages) {
      if (page.path === pathname) {
        return { page, params: {}, query }
      }
    }

    // Try dynamic routes
    for (const page of pages) {
      if (!page.path) continue
      // TypeScript doesn't narrow the type after the continue, so we need to assert
      const params = this.matchDynamicRoute(pathname, (page.path as unknown) as string)
      if (params !== null) {
        return { page, params, query }
      }
    }

    return null
  }

  /**
   * Match dynamic route and extract parameters
   *
   * Examples:
   *   /posts/:id -> /posts/123 -> { id: '123' }
   *   /posts/:id/edit -> /posts/123/edit -> { id: '123' }
   *   /users/:userId/posts/:postId -> /users/1/posts/2 -> { userId: '1', postId: '2' }
   */
  private matchDynamicRoute(
    pathname: string,
    pattern: string
  ): Record<string, string> | null {
    // Convert pattern to regex
    const paramNames: string[] = []
    const regexPattern = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })

    // Match against regex
    const regex = new RegExp(`^${regexPattern}$`)
    const match = pathname.match(regex)

    if (!match) {
      return null
    }

    // Extract parameters
    const params: Record<string, string> = {}
    paramNames.forEach((name, index) => {
      const value = match[index + 1]
      if (value) {
        params[name] = value
      }
    })

    return params
  }

  /**
   * Parse query string into object
   */
  private parseQueryString(queryString: string): Record<string, string> {
    if (!queryString) {
      return {}
    }

    const params: Record<string, string> = {}
    const pairs = queryString.split('&')

    for (const pair of pairs) {
      const [key, value] = pair.split('=')
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '')
      }
    }

    return params
  }

  /**
   * Generate path from pattern and params
   *
   * Example:
   *   generatePath('/posts/:id', { id: '123' }) -> '/posts/123'
   */
  generatePath(pattern: string, params: Record<string, string>): string {
    return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
      const value = params[name]
      if (!value) {
        throw new Error(`Missing parameter: ${name}`)
      }
      return encodeURIComponent(value)
    })
  }
}
