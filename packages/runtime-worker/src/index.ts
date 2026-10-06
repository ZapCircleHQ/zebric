/**
 * Zebric Runtime - CloudFlare Workers Adapter
 *
 * Platform-specific implementations for CloudFlare Workers.
 */

// Workers-specific exports
export { ZebricWorkersEngine, createWorkerHandler } from './engine.js'
export type { WorkersEnv, WorkersEngineConfig, WorkersAuthConfig, WorkersHandlerConfig } from './engine.js'

// Platform services
export * from './database/index.js'
export * from './cache/index.js'
export * from './storage/index.js'

// Session & Security
export * from './auth/index.js'
export * from './session/index.js'
export * from './security/index.js'

// Renderer
export { KVTemplateLoader } from './renderer/kv-template-loader.js'
export { BundledTemplateLoader } from './renderer/bundled-template-loader.js'
export type { BundledTemplateLoaderConfig } from './renderer/bundled-template-loader.js'

// Behaviors
export { BehaviorRegistry } from './behaviors/behavior-registry.js'
export * from './behaviors/example-behaviors.js'

// Query Executor
export { WorkersQueryExecutor } from './query/workers-query-executor.js'

// API discovery
export { generateWorkersOpenApi, registerWorkersDiscoveryRoutes } from './api/discovery.js'

export { D1WorkflowExecutor } from './workflows/d1-workflow-executor.js'
export { D1WorkflowOutbox } from './workflows/d1-workflow-outbox.js'
export type { WorkflowEventIntent } from './workflows/d1-workflow-outbox.js'
export type { WorkersWorkflowServices, WorkersWorkflowJob } from './workflows/d1-workflow-executor.js'

export type { DurableWorkflowPayload, DurableWorkflowStep, DurableWorkflowBinding } from './workflows/durable-workflow.js'
