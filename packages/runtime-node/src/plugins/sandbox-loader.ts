import { builtinModules, createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vm from 'node:vm'
import type { Plugin, PluginCapability } from '@zebric/runtime-core'

export interface SandboxModuleLoaderOptions {
  capabilities?: PluginCapability[]
  timeoutMs?: number
}

const BUILTIN_DENYLIST = new Set(builtinModules)

/**
 * SandboxModuleLoader loads ESM-based plugins inside an isolated VM context.
 * It blocks access to Node built-ins and only exposes web-standard globals,
 * keeping the limited plugin contract consistent across runtimes.
 */
export class SandboxModuleLoader {
  private readonly require = createRequire(import.meta.url)
  private readonly capabilities: Set<PluginCapability>
  private readonly timeout: number

  constructor(options: SandboxModuleLoaderOptions = {}) {
    this.capabilities = new Set(options.capabilities || [])
    this.timeout = options.timeoutMs ?? 2000
  }

  async load(specifier: string): Promise<Plugin> {
    const entryPath = this.resolveSpecifier(specifier)
    const context = this.createContext()
    const moduleCache = new Map<string, vm.SourceTextModule>()

    const entryModule = await this.instantiateModule(entryPath, context, moduleCache)
    await entryModule.evaluate({ timeout: this.timeout })

    const exported = (entryModule.namespace as any).default ?? entryModule.namespace
    return exported as Plugin
  }

  private createContext(): vm.Context {
    const sandboxGlobals: Record<string, unknown> = {
      console,
      setTimeout,
      clearTimeout,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      AbortController,
      crypto: globalThis.crypto,
    }

    if (this.capabilities.has('network') && typeof fetch === 'function') {
      sandboxGlobals.fetch = (...args: Parameters<typeof fetch>) => fetch(...args)
    }

    return vm.createContext(sandboxGlobals)
  }

  private resolveSpecifier(specifier: string, parent?: string): string {
    if (specifier.startsWith('node:') || BUILTIN_DENYLIST.has(specifier)) {
      throw new Error(`Access to builtin module "${specifier}" is not allowed in limited plugins`)
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return path.resolve(process.cwd(), specifier)
    }

    const searchPaths: string[] = []
    if (parent) {
      searchPaths.push(path.dirname(parent))
    }
    searchPaths.push(process.cwd())

    return this.require.resolve(specifier, { paths: searchPaths })
  }

  private async instantiateModule(
    filename: string,
    context: vm.Context,
    cache: Map<string, vm.SourceTextModule>
  ): Promise<vm.SourceTextModule> {
    if (cache.has(filename)) {
      return cache.get(filename)!
    }

    const source = await this.readModuleSource(filename)
    const loader = this

    const module = new vm.SourceTextModule(source, {
      identifier: filename,
      context,
      initializeImportMeta(meta) {
        meta.url = pathToFileURL(filename).href
      },
      importModuleDynamically: async (specifier, referencingModule) => {
        const linked = await loader.linkModule(
          specifier,
          referencingModule.identifier as string,
          context,
          cache
        )
        await linked.evaluate({ timeout: loader.timeout })
        return linked
      },
    })

    cache.set(filename, module)

    await module.link(async (specifier) => {
      return loader.linkModule(specifier, filename, context, cache)
    })

    return module
  }

  private async linkModule(
    specifier: string,
    parentId: string,
    context: vm.Context,
    cache: Map<string, vm.SourceTextModule>
  ): Promise<vm.SourceTextModule> {
    if (specifier === '@zebric/plugin-sdk') {
      return this.buildPluginSdkModule(context)
    }

    const resolved = this.resolveSpecifier(specifier, parentId)
    return this.instantiateModule(resolved, context, cache)
  }

  private async readModuleSource(filename: string): Promise<string> {
    const extension = path.extname(filename)
    if (extension === '.json') {
      const json = await readFile(filename, 'utf8')
      const parsed = JSON.parse(json)
      return `export default ${JSON.stringify(parsed)};`
    }

    return await readFile(filename, 'utf8')
  }

  private buildPluginSdkModule(context: vm.Context): vm.SourceTextModule {
    const source = `
      export const definePlugin = (config) => config;
      export const PluginSDKVersion = 'sandbox';
    `

    return new vm.SourceTextModule(source, { context })
  }
}
