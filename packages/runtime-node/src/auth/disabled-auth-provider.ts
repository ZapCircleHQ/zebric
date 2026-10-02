import type { AuthProvider, UserSession } from '@zebric/runtime-core'

/**
 * Auth provider used when a Blueprint has no [auth] configuration.
 *
 * Public applications still need a SessionManager because the runtime passes
 * session context through its shared request pipeline. Returning no session
 * keeps that pipeline intact without initializing Better Auth or requiring its
 * database tables.
 */
export class DisabledAuthProvider implements AuthProvider {
  getAuthInstance(): never {
    throw new Error('Authentication is not configured for this application')
  }

  async getSession(_request: Request): Promise<UserSession | null> {
    return null
  }

  hasRole(_session: UserSession | null, _role: string): boolean {
    return false
  }

  ownsResource(_session: UserSession | null, _resourceUserId: string): boolean {
    return false
  }
}
