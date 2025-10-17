/**
 * Blueprint Loader
 *
 * Loads and validates Blueprint from filesystem (JSON or TOML).
 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import * as TOML from '@iarna/toml'
import { BlueprintSchema } from './schema.js'
import type { Blueprint } from '../types/index.js'

export class BlueprintValidationError extends Error {
  constructor(
    message: string,
    public errors: any[]
  ) {
    super(message)
    this.name = 'BlueprintValidationError'
  }
}

export class BlueprintLoader {
  /**
   * Load Blueprint from file path
   */
  async load(path: string): Promise<Blueprint> {
    try {
      const content = await readFile(path, 'utf-8')

      // Detect file format from extension
      const isTOML = path.endsWith('.toml')

      // Parse based on format
      let data: any
      if (isTOML) {
        const parsed = TOML.parse(content)
        // Transform spec-compliant TOML to Blueprint JSON structure
        data = this.transformTOML(parsed)
        // Remove Symbol keys added by TOML parser (for Zod 4 compatibility)
        data = this.stripSymbolKeys(data)
      } else {
        data = JSON.parse(content)
      }

      // Validate against schema
      const result = BlueprintSchema.safeParse(data)

      if (!result.success) {
        throw new BlueprintValidationError(
          'Blueprint validation failed',
          result.error.errors
        )
      }

      const blueprint = result.data as Blueprint

      // Add hash
      blueprint.hash = this.generateHash(content)

      // Validate references
      this.validateReferences(blueprint)

      return blueprint
    } catch (error) {
      if (error instanceof BlueprintValidationError) {
        throw error
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid format in Blueprint: ${error.message}`)
      }
      throw error
    }
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
   * Transform spec-compliant TOML to Blueprint JSON structure
   * Handles both [entity.Name] and [[entities]] syntax
   */
  private transformTOML(parsed: any): any {
    // If already in correct format (has entities array), return as-is
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
        // Convert query/queries naming
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

  /**
   * Generate hash of Blueprint content
   */
  private generateHash(content: string): string {
    return 'sha256:' + createHash('sha256').update(content).digest('hex')
  }

  /**
   * Validate entity references, field refs, etc.
   */
  private validateReferences(blueprint: Blueprint): void {
    const entityNames = new Set(blueprint.entities.map((e) => e.name))
    const errors: string[] = []

    // Check entity references in pages
    for (const page of blueprint.pages) {
      // Check queries reference valid entities
      if (page.queries) {
        for (const [queryName, query] of Object.entries(page.queries)) {
          if (!entityNames.has(query.entity)) {
            errors.push(
              `Page "${page.path}" query "${queryName}" references unknown entity "${query.entity}"`
            )
          }
        }
      }

      // Check form references valid entity
      if (page.form) {
        if (!entityNames.has(page.form.entity)) {
          errors.push(
            `Page "${page.path}" form references unknown entity "${page.form.entity}"`
          )
        }
      }
    }

    // Check relation references
    for (const entity of blueprint.entities) {
      if (entity.relations) {
        for (const [relName, relation] of Object.entries(entity.relations)) {
          if (!entityNames.has(relation.entity)) {
            errors.push(
              `Entity "${entity.name}" relation "${relName}" references unknown entity "${relation.entity}"`
            )
          }
        }
      }

      // Check field refs
      for (const field of entity.fields) {
        if (field.type === 'Ref' && field.ref) {
          const [refEntity] = field.ref.split('.')
          if (!entityNames.has(refEntity)) {
            errors.push(
              `Entity "${entity.name}" field "${field.name}" references unknown entity "${refEntity}"`
            )
          }
        }
      }
    }

    // Check workflow entity references
    if (blueprint.workflows) {
      for (const workflow of blueprint.workflows) {
        if (!entityNames.has(workflow.trigger.entity)) {
          errors.push(
            `Workflow "${workflow.name}" trigger references unknown entity "${workflow.trigger.entity}"`
          )
        }
      }
    }

    if (errors.length > 0) {
      throw new BlueprintValidationError(
        'Blueprint reference validation failed',
        errors.map((e) => ({ message: e }))
      )
    }
  }

  /**
   * Validate Blueprint version compatibility
   */
  validateVersion(blueprint: Blueprint, engineVersion: string): void {
    const minVersion = blueprint.project.runtime.min_version

    // Simple semver check (can be enhanced with proper semver library)
    const [minMajor, minMinor] = minVersion.split('.').map(Number)
    const [engineMajor, engineMinor] = engineVersion.split('.').map(Number)

    if (
      engineMajor < minMajor ||
      (engineMajor === minMajor && engineMinor < minMinor)
    ) {
      throw new Error(
        `Blueprint requires engine version ${minVersion} or higher, but running ${engineVersion}`
      )
    }
  }
}
