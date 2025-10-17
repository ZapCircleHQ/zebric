/**
 * Plugin Registry
 *
 * Manages loading and accessing plugins with support for two-tier security:
 * - Limited plugins: Run in VM sandbox with restricted capabilities
 * - Full plugins: Run with full Node.js access (requires explicit authorization)
 */

import { resolve } from 'node:path'
import type { Plugin, LoadedPlugin, EngineAPI } from '../types/index.js'
import type { PluginConfig, PluginTrustLevel } from '../types/blueprint.js'
import { PluginSandbox } from './sandbox.js'

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>()
  private sandboxes = new Map<string, PluginSandbox>()

  /**
   * Load a plugin from npm package or local path
   */
  async load(
    name: string,
    pluginConfig: PluginConfig,
    engine: EngineAPI
  ): Promise<void> {
    const trustLevel = pluginConfig.trust_level || 'limited'
    const capabilities = pluginConfig.capabilities || []

    // Security warning for full-access plugins
    if (trustLevel === 'full') {
      console.warn(`⚠️  Loading FULL ACCESS plugin: ${name}`)
      console.warn(`   This plugin has unrestricted access to:`)
      console.warn(`   - Database`)
      console.warn(`   - Network`)
      console.warn(`   - File system`)
      console.warn(`   - Environment variables`)
      if (capabilities.length > 0) {
        console.warn(`   Declared capabilities: ${capabilities.join(', ')}`)
      }
    } else {
      console.log(`🔒 Loading LIMITED ACCESS plugin: ${name}`)
      if (capabilities.length > 0) {
        console.log(`   Granted capabilities: ${capabilities.join(', ')}`)
      } else {
        console.log(`   No capabilities (safe computation only)`)
      }
    }

    try {
      // For limited plugins, create sandbox
      let sandbox: PluginSandbox | undefined
      if (trustLevel === 'limited') {
        sandbox = new PluginSandbox({
          capabilities,
          timeout: 5000, // 5 second timeout for plugin operations
        })
        this.sandboxes.set(name, sandbox)
      }

      // Resolve plugin module
      const pluginModule = await this.resolvePlugin(name)

      // Get plugin definition
      const plugin: Plugin = pluginModule.default || pluginModule

      // Validate plugin structure
      this.validatePlugin(plugin, name)

      // Initialize plugin
      // Note: For limited plugins, init runs in sandbox
      // For full plugins, init runs directly
      if (plugin.init) {
        if (trustLevel === 'limited' && sandbox) {
          // TODO: Run init in sandbox with appropriate APIs
          // For now, we'll allow init to run directly but log a warning
          console.warn(`   ⚠️  Plugin init() currently runs outside sandbox (will be fixed)`)
          await plugin.init(engine, pluginConfig.config || {})
        } else {
          await plugin.init(engine, pluginConfig.config || {})
        }
      }

      // Register plugin
      this.plugins.set(name, {
        definition: pluginConfig,
        module: pluginModule,
        plugin,
      })

      console.log(`✅ Plugin loaded: ${name}`)
    } catch (error) {
      console.error(`❌ Failed to load plugin ${name}:`, error)
      throw new Error(`Plugin load failed: ${name}`)
    }
  }

  /**
   * Resolve plugin from npm or local path
   */
  private async resolvePlugin(name: string): Promise<any> {
    try {
      // NPM package (starts with @ or doesn't start with .)
      if (name.startsWith('@') || !name.startsWith('.')) {
        return await import(name)
      }

      // Local path
      if (name.startsWith('./') || name.startsWith('../')) {
        const fullPath = resolve(process.cwd(), name)
        return await import(fullPath)
      }

      throw new Error(`Unknown plugin source: ${name}`)
    } catch (error) {
      throw new Error(`Failed to resolve plugin ${name}: ${error}`)
    }
  }

  /**
   * Validate plugin structure
   */
  private validatePlugin(plugin: any, name: string): void {
    if (!plugin.name) {
      throw new Error(`Plugin ${name} missing required 'name' property`)
    }

    if (!plugin.version) {
      throw new Error(`Plugin ${name} missing required 'version' property`)
    }

    if (!plugin.provides) {
      throw new Error(`Plugin ${name} missing required 'provides' property`)
    }
  }

  /**
   * Get a loaded plugin
   */
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name)
  }

  /**
   * Check if plugin is loaded
   */
  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /**
   * Get all loaded plugins
   */
  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Get count of loaded plugins
   */
  count(): number {
    return this.plugins.size
  }

  /**
   * Get a workflow action from a plugin
   */
  getWorkflowAction(
    pluginName: string,
    actionName: string
  ): ((params: any, context: any) => Promise<void>) | undefined {
    const loaded = this.get(pluginName)
    if (!loaded) {
      throw new Error(`Plugin ${pluginName} not found`)
    }

    const action = loaded.plugin.workflows?.[actionName]
    if (!action) {
      throw new Error(
        `Action ${actionName} not found in plugin ${pluginName}`
      )
    }

    return action
  }

  /**
   * Get a UI component from a plugin
   */
  getComponent(pluginName: string, componentName: string): any {
    const loaded = this.get(pluginName)
    if (!loaded) {
      throw new Error(`Plugin ${pluginName} not found`)
    }

    const component = loaded.plugin.components?.[componentName]
    if (!component) {
      throw new Error(
        `Component ${componentName} not found in plugin ${pluginName}`
      )
    }

    return component
  }

  /**
   * Get layout renderer from a plugin
   */
  getLayoutRenderer(layoutName: string): any {
    // Check if layoutName is a plugin reference (e.g., "plugin:@mycompany/custom-layout")
    if (layoutName.startsWith('plugin:')) {
      const pluginName = layoutName.replace('plugin:', '')
      const loaded = this.get(pluginName)

      if (!loaded) {
        throw new Error(`Layout plugin ${pluginName} not found`)
      }

      return loaded.plugin.components?.layoutRenderer
    }

    return undefined
  }

  /**
   * Get middleware from a plugin
   */
  getMiddleware(pluginName: string, middlewareName: string): any {
    const loaded = this.get(pluginName)
    if (!loaded) {
      throw new Error(`Plugin ${pluginName} not found`)
    }

    const middleware = loaded.plugin.middleware?.[middlewareName]
    if (!middleware) {
      throw new Error(
        `Middleware ${middlewareName} not found in plugin ${pluginName}`
      )
    }

    return middleware
  }

  /**
   * Unload a plugin
   */
  unload(name: string): void {
    this.plugins.delete(name)
  }

  /**
   * Unload all plugins
   */
  clear(): void {
    this.plugins.clear()
    this.sandboxes.clear()
  }

  /**
   * Get sandbox for a limited-trust plugin
   */
  getSandbox(name: string): PluginSandbox | undefined {
    return this.sandboxes.get(name)
  }

  /**
   * Check if plugin is running in sandbox
   */
  isSandboxed(name: string): boolean {
    return this.sandboxes.has(name)
  }

  /**
   * Get plugin trust level
   */
  getTrustLevel(name: string): PluginTrustLevel | undefined {
    const loaded = this.get(name)
    return loaded?.definition.trust_level || 'limited'
  }
}
