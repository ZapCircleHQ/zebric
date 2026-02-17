/**
 * Zebric Runtime Core
 *
 * Platform-agnostic runtime engine and interfaces.
 * No Node.js or platform-specific dependencies.
 */

// Platform Ports
export * from './ports.js'

// Blueprint Types & Schemas
export * from './types/blueprint.js'
export * from './types/plugin.js'
export * from './blueprint/schema.js'
export * from './blueprint/loader.js'
export * from './blueprint/validation-error.js'

// Database
export * from './database/access-control.js'
// schema-generator and schema-diff moved to runtime-node (Drizzle-specific)
// query-executor moved to runtime-node (depends on connection, metrics)

// Security
export * from './security/html-escape.js'
export * from './security/error-sanitizer.js'
export * from './security/input-validator.js'

// Rendering
export * from './renderer/theme.js'
export * from './renderer/html-renderer.js'
export * from './renderer/template-system.js'
export * from './renderer/default-templates.js'
export * from './renderer/handlebars-engine.js'
export * from './renderer/liquid-engine.js'

// Cache Interface
export * from './cache/cache-interface.js'

// Auth Interfaces
export * from './auth/provider.js'
export * from './auth/permissions.js'
export * from './auth/session.js'

// API
export * from './api/openapi-generator.js'

// Routing
export * from './routing/route-matcher.js'
export * from './routing/request-handler.js'
export * from './routing/request-ports.js'
