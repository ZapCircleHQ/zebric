/**
 * Blueprint Loader
 *
 * Node.js-specific blueprint loader that reads from the filesystem.
 */

import { BlueprintParser, createCompositionError, detectFormat } from '@zebric/runtime-core'
import type { Blueprint, BlueprintFragmentSchemaType } from '@zebric/runtime-core'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'

export type BlueprintDefinitionKind =
  | 'entity'
  | 'page'
  | 'workflow'
  | 'command'
  | 'service'
  | 'plugin'
  | 'skill'
  | 'auth'
  | 'ui'
  | 'ux'
  | 'design_adapter'
  | 'design_system'
  | 'notifications'

export interface BlueprintSourceLocation {
  file: string
  line?: number
}

const collectionDefinitions: Array<{
  field: keyof BlueprintFragmentSchemaType
  kind: BlueprintDefinitionKind
  identity: (value: any) => string
}> = [
  { field: 'entities', kind: 'entity', identity: value => value.name },
  { field: 'pages', kind: 'page', identity: value => value.path },
  { field: 'workflows', kind: 'workflow', identity: value => value.name },
  { field: 'commands', kind: 'command', identity: value => value.name },
  { field: 'services', kind: 'service', identity: value => value.name },
  { field: 'plugins', kind: 'plugin', identity: value => value.name },
  { field: 'skills', kind: 'skill', identity: value => value.name },
]

const singletonDefinitions: Array<keyof Pick<Blueprint,
  'auth' | 'ui' | 'ux' | 'design_adapter' | 'design_system' | 'notifications'
>> = ['auth', 'ui', 'ux', 'design_adapter', 'design_system', 'notifications']

export class BlueprintLoader {
  private parser: BlueprintParser
  private loadedFiles: string[] = []
  private sources = new Map<string, BlueprintSourceLocation>()

  constructor() {
    this.parser = new BlueprintParser()
  }

  /**
   * Load and parse a blueprint from a file path
   */
  async load(path: string): Promise<Blueprint> {
    const rootPath = await realpath(resolve(path))
    const format = detectFormat(rootPath)
    if (format === 'json') {
      this.loadedFiles = [rootPath]
      this.sources.clear()
      return this.parser.parse(await readFile(rootPath, 'utf-8'), format, rootPath)
    }

    const rootDir = dirname(rootPath)
    const visited = new Set<string>()
    const active: string[] = []
    const contentForHash: string[] = []
    const composed: Record<string, any> = { entities: [], pages: [] }
    this.loadedFiles = []
    this.sources.clear()

    const visit = async (candidatePath: string, root: boolean): Promise<void> => {
      let canonicalPath: string
      try {
        canonicalPath = await realpath(candidatePath)
      } catch (error) {
        throw createCompositionError([
          `Unable to load imported Blueprint file "${candidatePath}": ${error instanceof Error ? error.message : String(error)}`,
        ], rootPath)
      }
      this.assertContained(rootDir, canonicalPath, rootPath)
      const cycleIndex = active.indexOf(canonicalPath)
      if (cycleIndex >= 0) {
        const chain = [...active.slice(cycleIndex), canonicalPath]
          .map(file => relative(rootDir, file) || file)
          .join(' -> ')
        throw createCompositionError([`Blueprint import cycle detected: ${chain}`], rootPath)
      }
      if (visited.has(canonicalPath)) return

      active.push(canonicalPath)
      const content = await readFile(canonicalPath, 'utf-8')
      const fragment = this.parser.parseFragment(content, canonicalPath)
      if (!root && (fragment.version !== undefined || fragment.project !== undefined)) {
        throw createCompositionError([
          `Imported Blueprint fragment "${relative(rootDir, canonicalPath)}" must not define version or project; those belong to the root Blueprint`,
        ], rootPath)
      }
      for (const importPath of fragment.imports ?? []) {
        this.validateImportPath(importPath, canonicalPath, rootPath)
        await visit(resolve(dirname(canonicalPath), importPath), false)
      }
      this.mergeFragment(composed, fragment, canonicalPath, content, rootPath)
      active.pop()
      visited.add(canonicalPath)
      this.loadedFiles.push(canonicalPath)
      contentForHash.push(`${relative(rootDir, canonicalPath)}\0${content}`)
    }

    await visit(rootPath, true)
    return this.parser.validateComposed(
      composed,
      contentForHash.join('\0'),
      rootPath,
      (kind, identity) => {
        const location = this.sources.get(`${kind}:${identity}`)
        return location ? formatLocation(location) : undefined
      },
    )
  }

  getLoadedFiles(): readonly string[] {
    return this.loadedFiles
  }

  getSourceLocation(kind: BlueprintDefinitionKind, identity: string): BlueprintSourceLocation | undefined {
    return this.sources.get(`${kind}:${identity}`)
  }

  /**
   * Validate version compatibility
   */
  validateVersion(blueprint: Blueprint, engineVersion: string): void {
    this.parser.validateVersion(blueprint, engineVersion)
  }

  private assertContained(rootDir: string, path: string, rootPath: string): void {
    const relativePath = relative(rootDir, path)
    if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) {
      throw createCompositionError([
        `Imported Blueprint file must remain under the root Blueprint directory: ${path}`,
      ], rootPath)
    }
  }

  private validateImportPath(importPath: string, importer: string, rootPath: string): void {
    if (isAbsolute(importPath)) {
      throw createCompositionError([`Import "${importPath}" in "${importer}" must be relative`], rootPath)
    }
    if (extname(importPath).toLowerCase() !== '.toml') {
      throw createCompositionError([`Import "${importPath}" in "${importer}" must name an explicit .toml file`], rootPath)
    }
    if (/[*?[\]]/.test(importPath)) {
      throw createCompositionError([`Import "${importPath}" in "${importer}" must not use glob syntax`], rootPath)
    }
  }

  private mergeFragment(
    target: Record<string, any>,
    fragment: BlueprintFragmentSchemaType,
    file: string,
    content: string,
    rootPath: string,
  ): void {
    if (fragment.version !== undefined) target.version = fragment.version
    if (fragment.project !== undefined) target.project = fragment.project

    for (const definition of collectionDefinitions) {
      const values = fragment[definition.field] as any[] | undefined
      if (!values) continue
      const destination = (target[definition.field] ??= []) as any[]
      for (const value of values) {
        const identity = definition.identity(value)
        const key = `${definition.kind}:${identity}`
        const source = this.definitionLocation(content, file, definition.kind, identity)
        const previous = this.sources.get(key)
        if (previous) {
          throw createCompositionError([
            `Duplicate ${definition.kind} definition "${identity}" in ${formatLocation(previous)} and ${formatLocation(source)}`,
          ], rootPath)
        }
        this.sources.set(key, source)
        destination.push(value)
      }
    }

    for (const field of singletonDefinitions) {
      const value = fragment[field]
      if (value === undefined) continue
      const key = `${field}:${field}`
      const source = this.definitionLocation(content, file, field, field)
      const previous = this.sources.get(key)
      if (previous) {
        throw createCompositionError([
          `Singleton Blueprint section "${field}" is defined in both ${formatLocation(previous)} and ${formatLocation(source)}`,
        ], rootPath)
      }
      this.sources.set(key, source)
      target[field] = value
    }
  }

  private definitionLocation(
    content: string,
    file: string,
    kind: BlueprintDefinitionKind,
    identity: string,
  ): BlueprintSourceLocation {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const isSingleton = singletonDefinitions.includes(kind as any)
    const table = kind === 'service' ? '(?:service|services)' : kind
    const header = isSingleton
      ? new RegExp(`^\\s*\\[\\s*${table}\\s*\\]`, 'i')
      : new RegExp(`^\\s*\\[\\s*${table}\\s*\\.\\s*["']?${escaped}["']?\\s*\\]`, 'i')
    const lines = content.split(/\r?\n/)
    const index = lines.findIndex(line => header.test(line))
    return { file, line: index >= 0 ? index + 1 : undefined }
  }
}

function formatLocation(location: BlueprintSourceLocation): string {
  return `${location.file}${location.line ? `:${location.line}` : ''}`
}
