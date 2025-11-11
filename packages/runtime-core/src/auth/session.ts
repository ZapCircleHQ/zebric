/**
 * Session Management
 *
 * Handles session retrieval and user context for authentication.
 * Now delegates to AuthProvider for pluggability.
 */

import type { AuthProvider, UserSession } from './provider.js'

export type { UserSession } from './provider.js'

export class SessionManager {
  constructor(private authProvider: AuthProvider) {}

  /**
   * Get session from request (Web API Request)
   */
  async getSession(request: Request): Promise<UserSession | null> {
    return this.authProvider.getSession(request)
  }

  /**
   * Check if user has required role
   */
  hasRole(session: UserSession | null, role: string): boolean {
    return this.authProvider.hasRole(session, role)
  }

  /**
   * Check if user owns a resource
   */
  ownsResource(session: UserSession | null, resourceUserId: string): boolean {
    return this.authProvider.ownsResource(session, resourceUserId)
  }
}
