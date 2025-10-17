/**
 * Authentication Module
 *
 * Exports authentication-related functionality with pluggable auth providers.
 */

// Auth Provider Interface
export type { AuthProvider, AuthProviderConfig, UserSession } from './provider.js'

// Better Auth Implementation (default)
export { BetterAuthProvider, createBetterAuthProvider } from './better-auth-provider.js'

// Legacy exports for backwards compatibility
export { createAuth, getAuthConfigFromBlueprint, type BetterAuthConfig } from './config.js'

// Session and Permission Management
export { SessionManager } from './session.js'
export { PermissionManager, type PermissionCheckContext } from './permissions.js'
