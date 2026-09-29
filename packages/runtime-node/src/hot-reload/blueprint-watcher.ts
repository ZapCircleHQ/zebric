/**
 * Blueprint File Watcher
 *
 * Watches blueprint files for changes and triggers hot reload
 */

import { watch, type FSWatcher } from 'chokidar'
import type { Logger } from '@zebric/observability'
import type { Blueprint } from '@zebric/runtime-core'
import { BlueprintLoader } from '../blueprint/loader.js'

export interface BlueprintWatcherOptions {
  blueprintPath: string
  onReload: (blueprint: Blueprint) => Promise<void>
  onError?: (error: Error) => void
  logger?: Logger
  blueprintFiles?: readonly string[]
}

export class BlueprintWatcher {
  private watcher: FSWatcher | null = null
  private isReloading = false
  private watchedFiles = new Set<string>()

  constructor(private options: BlueprintWatcherOptions) {}

  /**
   * Start watching blueprint file for changes
   */
  start(): void {
    this.options.logger?.info('Watching blueprint for changes', {
      blueprintPath: this.options.blueprintPath,
    })

    const initialFiles = this.options.blueprintFiles?.length
      ? [...this.options.blueprintFiles]
      : [this.options.blueprintPath]
    this.watchedFiles = new Set(initialFiles)
    this.watcher = watch(initialFiles, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    })

    const reload = async (path: string) => {
      if (this.isReloading) {
        this.options.logger?.info('Blueprint reload already in progress, skipping duplicate change event')
        return
      }

      this.isReloading = true
      this.options.logger?.info('Blueprint changed, reloading', { path })

      try {
        const startTime = Date.now()

        // Load and parse blueprint
        const { blueprint, files } = await this.loadBlueprint(this.options.blueprintPath)
        await this.syncWatchedFiles(files)

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
    }

    this.watcher.on('change', reload)
    this.watcher.on('unlink', reload)

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
  private async loadBlueprint(path: string): Promise<{ blueprint: Blueprint; files: readonly string[] }> {
    const loader = new BlueprintLoader()
    const blueprint = await loader.load(path)
    return { blueprint, files: loader.getLoadedFiles() }
  }

  private async syncWatchedFiles(files: readonly string[]): Promise<void> {
    if (!this.watcher) return
    const next = new Set(files)
    const added = files.filter(file => !this.watchedFiles.has(file))
    const removed = [...this.watchedFiles].filter(file => !next.has(file))
    if (added.length > 0) this.watcher.add(added)
    if (removed.length > 0) await this.watcher.unwatch(removed)
    this.watchedFiles = next
  }
}
