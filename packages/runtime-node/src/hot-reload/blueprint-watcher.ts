/**
 * Blueprint File Watcher
 *
 * Watches blueprint files for changes and triggers hot reload
 */

import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'node:fs/promises'
import type { Logger } from '@zebric/observability'
import { BlueprintParser, detectFormat } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'

export interface BlueprintWatcherOptions {
  blueprintPath: string
  onReload: (blueprint: Blueprint) => Promise<void>
  onError?: (error: Error) => void
  logger?: Logger
}

export class BlueprintWatcher {
  private watcher: FSWatcher | null = null
  private isReloading = false

  constructor(private options: BlueprintWatcherOptions) {}

  /**
   * Start watching blueprint file for changes
   */
  start(): void {
    this.options.logger?.info('Watching blueprint for changes', {
      blueprintPath: this.options.blueprintPath,
    })

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
        this.options.logger?.info('Blueprint reload already in progress, skipping duplicate change event')
        return
      }

      this.isReloading = true
      this.options.logger?.info('Blueprint changed, reloading', { path })

      try {
        const startTime = Date.now()

        // Load and parse blueprint
        const blueprint = await this.loadBlueprint(this.options.blueprintPath)

        // Trigger reload
        await this.options.onReload(blueprint)

        const duration = Date.now() - startTime
        this.options.logger?.info('Blueprint reload complete', { durationMs: duration })
      } catch (error) {
        this.options.logger?.error('Failed to reload blueprint', { error })
        if (this.options.onError) {
          this.options.onError(error as Error)
        }
      } finally {
        this.isReloading = false
      }
    })

    this.watcher.on('error', (error) => {
      this.options.logger?.error('Blueprint watcher error', { error })
      if (this.options.onError) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)))
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
      this.options.logger?.info('Stopped watching blueprint')
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
