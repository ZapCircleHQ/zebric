/**
 * Blueprint Loader
 *
 * Node.js-specific blueprint loader that reads from the filesystem.
 */

import { BlueprintParser, detectFormat } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
import { readFile } from 'node:fs/promises'

export class BlueprintLoader {
  private parser: BlueprintParser

  constructor() {
    this.parser = new BlueprintParser()
  }

  /**
   * Load and parse a blueprint from a file path
   */
  async load(path: string): Promise<Blueprint> {
    const content = await readFile(path, 'utf-8')
    const format = detectFormat(path)
    return this.parser.parse(content, format, path)
  }

  /**
   * Validate version compatibility
   */
  validateVersion(blueprint: Blueprint, engineVersion: string): void {
    this.parser.validateVersion(blueprint, engineVersion)
  }
}
