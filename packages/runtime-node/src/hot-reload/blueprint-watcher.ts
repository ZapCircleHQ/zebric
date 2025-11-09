/**
 * Blueprint File Watcher
 *
 * Watches blueprint files for changes and triggers hot reload
 */

import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'node:fs/promises'
import { parse as parseToml } from '@iarna/toml'
import { BlueprintSchema } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'

export interface BlueprintWatcherOptions {
  blueprintPath: string
  onReload: (blueprint: Blueprint) => Promise<void>
  onError?: (error: Error) => void
}

export class BlueprintWatcher {
  private watcher: FSWatcher | null = null
  private isReloading = false

  constructor(private options: BlueprintWatcherOptions) {}

  /**
   * Start watching blueprint file for changes
   */
  start(): void {
    console.log(`👀 Watching for Blueprint changes: ${this.options.blueprintPath}`)

    this.watcher = watch(this.options.blueprintPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    })

    this.watcher.on('change', async (path) => {
      if (this.isReloading) {
        console.log('⏳ Reload already in progress, skipping...')
        return
      }

      this.isReloading = true
      console.log(`\n📝 Blueprint changed: ${path}`)
      console.log('🔄 Reloading...')

      try {
        const startTime = Date.now()

        // Load and parse blueprint
        const blueprint = await this.loadBlueprint(this.options.blueprintPath)

        // Trigger reload
        await this.options.onReload(blueprint)

        const duration = Date.now() - startTime
        console.log(`✅ Reload complete in ${duration}ms\n`)
      } catch (error) {
        console.error('❌ Failed to reload Blueprint:', error)
        if (this.options.onError) {
          this.options.onError(error as Error)
        }
      } finally {
        this.isReloading = false
      }
    })

    this.watcher.on('error', (error) => {
      console.error('❌ Blueprint watcher error:', error)
      if (this.options.onError) {
        this.options.onError(error)
      }
    })
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
      console.log('👋 Stopped watching Blueprint')
    }
  }

  /**
   * Load and validate blueprint from file
   */
  private async loadBlueprint(path: string): Promise<Blueprint> {
    const content = await readFile(path, 'utf-8')

    // Detect file format
    const isTOML = path.endsWith('.toml')
    const isJSON = path.endsWith('.json')

    let data: any

    if (isTOML) {
      // Parse TOML and transform to Blueprint structure
      const parsed = parseToml(content)
      data = this.transformTOML(parsed)
      // Remove Symbol keys added by TOML parser (for Zod 4 compatibility)
      data = this.stripSymbolKeys(data)
    } else if (isJSON) {
      data = JSON.parse(content)
    } else {
      throw new Error(`Unknown blueprint format: ${path}`)
    }

    // Validate against schema
    const result = BlueprintSchema.safeParse(data)
    if (!result.success) {
      const errors = result.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join('\n')
      throw new Error(`Blueprint validation failed:\n${errors}`)
    }

    return result.data as Blueprint
  }

  /**
   * Recursively remove Symbol keys from an object (added by TOML parser)
   * Zod 4 is stricter about record keys and rejects Symbol keys
   */
  private stripSymbolKeys(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.stripSymbolKeys(item))
    }

    if (typeof obj === 'object') {
      const cleaned: any = {}
      for (const key of Object.keys(obj)) {
        // Only copy string keys, skip Symbol keys
        if (typeof key === 'string') {
          cleaned[key] = this.stripSymbolKeys(obj[key])
        }
      }
      return cleaned
    }

    return obj
  }

  /**
   * Transform TOML to Blueprint JSON structure
   * (Same logic as loader.ts)
   */
  private transformTOML(parsed: any): any {
    if (parsed.entities) {
      return parsed
    }

    const transformed: any = {
      version: parsed.version,
      project: parsed.project,
      entities: [],
      pages: [],
      auth: parsed.auth,
      ui: parsed.ui,
    }

    // Transform [entity.Name] to entities array
    if (parsed.entity) {
      for (const [entityName, entityDef] of Object.entries(parsed.entity)) {
        transformed.entities.push({
          name: entityName,
          ...(entityDef as any),
        })
      }
    }

    // Transform [page."/path"] to pages array
    if (parsed.page) {
      for (const [pagePath, pageDef] of Object.entries(parsed.page)) {
        const pageData: any = { path: pagePath, ...(pageDef as any) }

        // Rename 'query' to 'queries' if present
        if (pageData.query) {
          pageData.queries = pageData.query
          delete pageData.query
        }

        transformed.pages.push(pageData)
      }
    }

    // Handle workflows if present
    if (parsed.workflow) {
      transformed.workflows = []
      for (const [workflowName, workflowDef] of Object.entries(parsed.workflow)) {
        transformed.workflows.push({
          name: workflowName,
          ...(workflowDef as any),
        })
      }
    }

    // Handle plugins if present
    if (parsed.plugin) {
      transformed.plugins = []
      for (const [pluginName, pluginDef] of Object.entries(parsed.plugin)) {
        transformed.plugins.push({
          name: pluginName,
          ...(pluginDef as any),
        })
      }
    }

    return transformed
  }
}
