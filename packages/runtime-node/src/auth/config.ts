/**
 * Better Auth Configuration
 *
 * Configures Better Auth for the Zebric Engine.
 */

import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import type { Blueprint, AuthProvider, AuthProviderConfig } from '@zebric/runtime-core'
import { BetterAuthProvider } from './better-auth-provider.js'

// Re-export for convenience
export type { AuthProviderConfig } from '@zebric/runtime-core'

/**
 * Create Better Auth provider instance
 */
export function createBetterAuthProvider(config: AuthProviderConfig): AuthProvider {
  return new BetterAuthProvider(config)
}

export interface BetterAuthConfig extends AuthProviderConfig {
  // Additional Better Auth specific config can go here if needed
}

/**
 * Create Better Auth instance configured for Zebric Engine
 */
export function createAuth(config: BetterAuthConfig): ReturnType<typeof betterAuth> {
  const { databaseUrl, blueprint, baseURL, secret, trustedOrigins} = config

  // Get auth providers from Blueprint
  const providers = blueprint.auth?.providers || ['email']

  // Configure email/password authentication
  const emailPassword = providers.includes('email')

  // Create better-sqlite3 database instance
  const db = new Database(databaseUrl)

  return betterAuth({
    database: db,
    baseURL,
    secret,
    trustedOrigins,
    emailAndPassword: emailPassword
      ? {
          enabled: true,
        }
      : undefined,
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },
    // Better Auth handles secure cookies automatically based on NODE_ENV
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  })
}

/**
 * Extract auth configuration from Blueprint
 */
export function getAuthConfigFromBlueprint(blueprint: Blueprint) {
  return {
    providers: blueprint.auth?.providers || ['email'],
  }
}
