import type { Blueprint, EngineAPI, LoadedPlugin, Plugin } from '@zebric/runtime-core'

/** Workers load statically imported modules; there is no runtime filesystem loader. */
export class BundledPluginRegistry {
  private readonly loaded = new Map<string, LoadedPlugin>()
  private ready?: Promise<void>
  private api?: EngineAPI

  constructor(blueprint: Blueprint, modules: Readonly<Record<string, Plugin>> = {}) {
    for (const definition of blueprint.plugins ?? []) {
      if (!definition.enabled) continue
      const plugin = modules[definition.name]
      if (!plugin) throw new Error(`Plugin ${definition.name} must be bundled in the Worker configuration`)
      if (!plugin.name || !plugin.version || !plugin.provides) throw new Error(`Invalid plugin: ${definition.name}`)
      if (definition.capabilities?.includes('filesystem')) throw new Error(`Plugin ${definition.name} requires a filesystem; use Node`)
      this.loaded.set(definition.name, { definition, module: plugin, plugin })
    }
  }

  initialize(api: EngineAPI, available: { db: boolean; auth: boolean; storage: boolean; cache: boolean }): Promise<void> {
    // A failed initialization stays failed; retrying a partially initialized plugin can duplicate effects.
    this.api = api
    return this.ready ??= (async () => {
      for (const { definition, plugin } of this.loaded.values()) {
        for (const requirement of ['db', 'auth', 'storage', 'cache'] as const) {
          if (plugin.requires?.[requirement] && !available[requirement]) {
            throw new Error(`Plugin ${definition.name} requires ${requirement}`)
          }
        }
        await plugin.init?.(api, definition.config ?? {})
      }
    })()
  }

  get(name: string): LoadedPlugin | undefined { return this.loaded.get(name) }
  list(): LoadedPlugin[] { return [...this.loaded.values()] }
  getPlugin(name: string) {
    const plugin = this.get(name)?.plugin
    if (!plugin) return undefined
    return { actions: Object.fromEntries(Object.entries(plugin.workflows ?? {}).map(([name, action]) =>
      [name, (params: Record<string, unknown>, context: unknown) => {
        if (!this.api) throw new Error('Plugins have not initialized')
        return action(params, { ...context as object, db: this.api.db, auth: this.api.auth,
          storage: this.api.storage, cache: this.api.cache, log: this.api.log })
      }])) }

  }
}
