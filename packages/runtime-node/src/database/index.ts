/**
 * Database Module
 *
 * Exports database components (both core and Node-specific).
 */

// Re-export from core
export { AccessControl } from '@zebric/runtime-core'

// Node-specific exports (Drizzle-based)
export * from './connection.js'
export * from './query-executor.js'
export * from './schema-generator.js'
export * from './schema-diff.js'
