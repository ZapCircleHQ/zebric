/**
 * Zebric Runtime - CloudFlare Workers Adapter
 *
 * Platform-specific implementations for CloudFlare Workers.
 */

// Workers-specific exports
export { ZebricWorkersEngine, createWorkerHandler } from './engine.js'
export type { WorkersEnv, WorkersEngineConfig } from './engine.js'

// Platform services
export * from './database/index.js'
export * from './cache/index.js'
export * from './storage/index.js'

// Session & Security
export * from './session/index.js'
export * from './security/index.js'

// Renderer
export { KVTemplateLoader } from './renderer/kv-template-loader.js'

// Behaviors
export { BehaviorRegistry } from './behaviors/behavior-registry.js'
export * from './behaviors/example-behaviors.js'

// Query Executor
export { WorkersQueryExecutor } from './query/workers-query-executor.js'
