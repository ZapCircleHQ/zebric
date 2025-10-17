/**
 * Zebric Plugin SDK
 *
 * SDK for building plugins for Zebric Engine.
 */

// Re-export types from runtime
export type {
  Plugin,
  PluginCapabilities,
  PluginRequirements,
  WorkflowAction,
  WorkflowContext,
  EngineAPI,
  MiddlewareHandler,
} from './types.js'

/**
 * Define a plugin
 */
export function definePlugin(config: any): any {
  return config
}
