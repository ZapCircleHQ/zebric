import {
  ServiceRegistry,
  type Blueprint,
  type ExecutionObserverPort,
  type ServiceConfig,
  type ServiceHandler,
} from '@zebric/runtime-core'
import type { PluginRegistry } from '../plugins/registry.js'

/** Build a registry whose implementations are resolved lazily from loaded plugins. */
export function createServiceRegistry(
  blueprint: Blueprint,
  plugins: PluginRegistry,
  observer?: ExecutionObserverPort,
): ServiceRegistry {
  return new ServiceRegistry(blueprint.services, {
    observer,
    resolveHandler: (service, operation) => resolvePluginHandler(plugins, service, operation),
  })
}

function resolvePluginHandler(
  plugins: PluginRegistry,
  service: ServiceConfig,
  operation: string,
): ServiceHandler | undefined {
  const pluginName = service.plugin ?? service.name
  const loaded = plugins.get(pluginName)
  if (!loaded) return undefined
  const integrations = loaded.plugin.integrations
  if (!integrations) return undefined
  const implementation = integrations[service.name] ?? integrations[pluginName] ?? integrations
  const handler = implementation?.[operation]
  if (typeof handler !== 'function') return undefined
  return (params, context) => handler(params, context)
}
