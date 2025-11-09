/**
 * Zebric Runtime - CloudFlare Workers Adapter
 *
 * Platform-specific implementations for CloudFlare Workers.
 */

// Re-export everything from core
export * from '@zebric/runtime-core'

// Workers-specific exports
export { ZebricWorkersEngine, createWorkerHandler } from './engine.js'
export type { WorkersEnv, WorkersEngineConfig } from './engine.js'

// Adapters
export * from './database/index.js'
export * from './cache/index.js'
export * from './storage/index.js'
