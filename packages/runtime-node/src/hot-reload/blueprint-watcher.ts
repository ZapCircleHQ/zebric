/**
 * Blueprint File Watcher
 *
 * Watches blueprint files for changes and triggers hot reload
 */

import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'node:fs/promises'
import { BlueprintParser, detectFormat } from '@zebric/runtime-core'
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
    const parser = new BlueprintParser()
    const format = detectFormat(path)
    return parser.parse(content, format, path)
  }
}
