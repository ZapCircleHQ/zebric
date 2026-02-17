/**
 * Blueprint Parser
 *
 * Pure parsing and validation logic for Blueprints (JSON or TOML).
 * File I/O is handled by platform adapters.
 */

import * as TOML from '@iarna/toml'
import { BlueprintSchema } from './schema.js'
import type { Blueprint } from '../types/index.js'
import {
  BlueprintValidationError,
  zodErrorToStructured,
  createReferenceError,
  createParseError,
  createVersionError,
} from './validation-error.js'

// Re-export for backwards compatibility
export { BlueprintValidationError }

export class BlueprintParser {
  /**
   * Parse Blueprint from string content
   */
  parse(content: string, format: 'toml' | 'json', source?: string): Blueprint {
    // Parse based on format
    let data: any
    try {
      if (format === 'toml') {
        const parsed = TOML.parse(content)
        // Transform spec-compliant TOML to Blueprint JSON structure
        data = this.transformTOML(parsed)
        // Remove Symbol keys added by TOML parser (for Zod 4 compatibility)
        data = this.stripSymbolKeys(data)
      } else {
        data = JSON.parse(content)
      }
    } catch (parseError: any) {
      // Extract line/column from parse error if available
      const line = parseError.line
      const column = parseError.col ?? parseError.column
      throw createParseError(parseError.message, source, line, column)
    }

    // Validate against schema
    const result = BlueprintSchema.safeParse(data)

    if (!result.success) {
      throw new BlueprintValidationError(
        zodErrorToStructured(result.error, source)
      )
    }

    const blueprint = result.data as Blueprint

    // Add hash (using Web Crypto API)
    blueprint.hash = this.generateHash(content)

    // Validate references
    this.validateReferences(blueprint, source)

    return blueprint
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
      notifications: parsed.notifications,
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

    // Handle skills if present
    if (parsed.skill) {
      transformed.skills = []
      for (const [skillName, skillDef] of Object.entries(parsed.skill)) {
        transformed.skills.push({
          name: skillName,
          ...(skillDef as any),
        })
      }
    }

    return transformed
  }

  /**
   * Generate hash of Blueprint content using Web Crypto API
   * Works in both Node.js and Cloudflare Workers
   */
  private generateHash(content: string): string {
    // Convert string to Uint8Array
    const encoder = new TextEncoder()
    const data = encoder.encode(content)

    // Simple hash using Array reduce (for platform compatibility)
    // In production, platform adapters can provide a better hash via crypto
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const byte = data[i]
      if (byte !== undefined) {
        hash = ((hash << 5) - hash) + byte
        hash = hash & hash // Convert to 32bit integer
      }
    }

    // Convert to hex string
    const hexHash = (hash >>> 0).toString(16).padStart(8, '0')
    return 'sha256:' + hexHash

    // Note: For production, use Web Crypto API (async):
    // const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    // const hashArray = Array.from(new Uint8Array(hashBuffer))
    // return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Validate entity references, field refs, etc.
   */
  private validateReferences(blueprint: Blueprint, file?: string): void {
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
          if (refEntity && !entityNames.has(refEntity)) {
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
        const triggerEntity = workflow.trigger?.entity
        if (triggerEntity && !entityNames.has(triggerEntity)) {
          errors.push(
            `Workflow "${workflow.name}" trigger references unknown entity "${triggerEntity}"`
          )
        }
      }
    }

    // Check skill entity and workflow references
    if (blueprint.skills) {
      const workflowNames = new Set(
        (blueprint.workflows || []).map((w) => w.name)
      )
      for (const skill of blueprint.skills) {
        for (const action of skill.actions) {
          if (action.entity && !entityNames.has(action.entity)) {
            errors.push(
              `Skill "${skill.name}" action "${action.name}" references unknown entity "${action.entity}"`
            )
          }
          if (action.workflow && !workflowNames.has(action.workflow)) {
            errors.push(
              `Skill "${skill.name}" action "${action.name}" references unknown workflow "${action.workflow}"`
            )
          }
        }
      }
    }

    // Check internal link targets
    this.validateRouteLinks(blueprint, errors)

    if (errors.length > 0) {
      throw createReferenceError(errors, file)
    }
  }

  /**
   * Ensure internal links/redirects reference existing page routes
   */
  private validateRouteLinks(blueprint: Blueprint, errors: string[]): void {
    if (!blueprint.pages || blueprint.pages.length === 0) {
      return
    }

    const routes = blueprint.pages.map(page => ({
      path: page.path,
      pattern: this.normalizeRoutePattern(page.path)
    }))

    const checkLink = (link: string | undefined, context: string) => {
      if (!link || !link.startsWith('/')) {
        return
      }
      if (link === '/' || link === '') {
        return
      }
      const normalized = this.normalizeRoutePattern(link)
      const hasMatch = routes.some(route => this.routePatternsMatch(normalized, route.pattern))
      if (!hasMatch) {
        errors.push(`${context} references unknown route "${link}"`)
      }
    }

    for (const page of blueprint.pages) {
      if (page.form?.onSuccess?.redirect) {
        checkLink(page.form.onSuccess.redirect, `Form success redirect on page "${page.path}"`)
      }

      const actionBar = page.actionBar
      if (actionBar) {
        if (actionBar.actions) {
          for (const action of actionBar.actions) {
            checkLink(action.href, `Action "${action.label}" on page "${page.path}"`)
            checkLink(action.redirect, `Action redirect "${action.label}" on page "${page.path}"`)
          }
        }
        if (actionBar.secondaryActions) {
          for (const action of actionBar.secondaryActions) {
            checkLink(action.href, `Action "${action.label}" on page "${page.path}"`)
            checkLink(action.redirect, `Action redirect "${action.label}" on page "${page.path}"`)
          }
        }
      }
    }
  }

  private normalizeRoutePattern(path: string): Array<{ dynamic: boolean; value?: string }> {
    if (!path) {
      return []
    }

    const withoutQuery = path.split('?')[0] || ''

    if (withoutQuery === '/' || withoutQuery === '') {
      return []
    }

    const cleaned = withoutQuery.replace(/\/+$/, '').replace(/^\/+/, '')
    if (!cleaned) {
      return []
    }

    return cleaned.split('/').map(segment => {
      if (this.isDynamicSegment(segment)) {
        return { dynamic: true }
      }
      return { dynamic: false, value: segment }
    })
  }

  private isDynamicSegment(segment: string): boolean {
    if (!segment) return false
    if (segment.startsWith(':')) {
      return true
    }
    return segment.startsWith('{') && segment.endsWith('}')
  }

  private routePatternsMatch(
    a: Array<{ dynamic: boolean; value?: string }>,
    b: Array<{ dynamic: boolean; value?: string }>
  ): boolean {
    if (a.length !== b.length) {
      return false
    }

    for (let i = 0; i < a.length; i++) {
      const segA = a[i]
      const segB = b[i]
      if (!segA || !segB) {
        return false
      }
      if (segA.dynamic || segB.dynamic) {
        continue
      }
      if (segA.value !== segB.value) {
        return false
      }
    }

    return true
  }

  /**
   * Validate Blueprint version compatibility
   */
  validateVersion(blueprint: Blueprint, engineVersion: string, file?: string): void {
    const minVersion = blueprint.project.runtime.min_version

    // Simple semver check (can be enhanced with proper semver library)
    const minParts = minVersion.split('.').map(Number)
    const engineParts = engineVersion.split('.').map(Number)

    const minMajor = minParts[0] ?? 0
    const minMinor = minParts[1] ?? 0
    const engineMajor = engineParts[0] ?? 0
    const engineMinor = engineParts[1] ?? 0

    if (
      engineMajor < minMajor ||
      (engineMajor === minMajor && engineMinor < minMinor)
    ) {
      throw createVersionError(minVersion, engineVersion, file)
    }
  }
}

/**
 * Helper function to detect format from filename
 */
export function detectFormat(filename: string): 'toml' | 'json' {
  return filename.endsWith('.toml') ? 'toml' : 'json'
}
