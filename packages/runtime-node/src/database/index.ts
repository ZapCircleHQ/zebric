/**
 * Database Module
 *
 * Exports database components (both core and Node-specific).
 */

// Re-export from core
export { SchemaGenerator, SchemaDiffer, AccessControl } from '@zebric/runtime-core'
export type { SchemaDiffResult } from '@zebric/runtime-core'

// Node-specific exports
export * from './connection.js'
export * from './query-executor.js'
