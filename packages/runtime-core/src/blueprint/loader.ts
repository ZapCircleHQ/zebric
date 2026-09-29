/**
 * Blueprint Parser
 *
 * Pure parsing and validation logic for Blueprints (JSON or TOML).
 * File I/O is handled by platform adapters.
 */

import { parse as parseTOML } from 'smol-toml'
import { BlueprintFragmentSchema, BlueprintSchema } from './schema.js'
import type { Blueprint } from '../types/index.js'
import {
  BlueprintValidationError,
  zodErrorToStructured,
  createReferenceError,
  createCompositionError,
  createParseError,
  createVersionError,
} from './validation-error.js'
import { analyzeTransactionalWorkflow } from './workflow-analysis.js'
import { validatePolicyCondition } from '../policy/evaluator.js'

// Re-export for backwards compatibility
export { BlueprintValidationError }

export class BlueprintParser {
  /**
   * Parse Blueprint from string content
   */
  parse(content: string, format: 'toml' | 'json', source?: string): Blueprint {
    const data = this.parseData(content, format, source)
    if (Array.isArray(data?.imports) && data.imports.length > 0) {
      throw createCompositionError([
        'Blueprint imports require a filesystem-aware BlueprintLoader; load this TOML from its file path',
      ], source)
    }
    return this.validateComposed(data, content, source)
  }

  /** Parse and structurally validate a partial TOML Blueprint module. */
  parseFragment(content: string, source?: string): import('./schema.js').BlueprintFragmentSchemaType {
    const data = this.parseData(content, 'toml', source)
    const result = BlueprintFragmentSchema.safeParse(data)
    if (!result.success) {
      throw new BlueprintValidationError(zodErrorToStructured(result.error, source))
    }
    return result.data
  }

  /** Validate a filesystem adapter's fully composed Blueprint. */
  validateComposed(
    data: unknown,
    hashContent: string,
    source?: string,
    sourceFor?: (kind: string, identity: string) => string | undefined,
  ): Blueprint {
    const result = BlueprintSchema.safeParse(data)
    if (!result.success) {
      throw new BlueprintValidationError(zodErrorToStructured(result.error, source))
    }
    const blueprint = result.data as Blueprint
    blueprint.hash = this.generateHash(hashContent)
    this.validateReferences(blueprint, source, sourceFor)
    return blueprint
  }

  private parseData(content: string, format: 'toml' | 'json', source?: string): any {
    try {
      const parsed = format === 'toml' ? parseTOML(content) : JSON.parse(content)
      return this.stripSymbolKeys(format === 'toml' ? this.transformTOML(parsed) : parsed)
    } catch (parseError: any) {
      throw createParseError(
        parseError.message,
        source,
        parseError.line,
        parseError.col ?? parseError.column,
      )
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
    const transformed: any = {
      version: parsed.version,
      project: parsed.project,
      entities: Array.isArray(parsed.entities) ? [...parsed.entities] : [],
      pages: Array.isArray(parsed.pages) ? [...parsed.pages] : [],
      workflows: Array.isArray(parsed.workflows) ? [...parsed.workflows] : undefined,
      commands: Array.isArray(parsed.commands) ? [...parsed.commands] : undefined,
      services: Array.isArray(parsed.services) ? [...parsed.services] : undefined,
      plugins: Array.isArray(parsed.plugins) ? [...parsed.plugins] : undefined,
      skills: Array.isArray(parsed.skills) ? [...parsed.skills] : undefined,
      auth: parsed.auth,
      ui: parsed.ui,
      ux: parsed.ux,
      design_adapter: parsed.design_adapter,
      design_system: parsed.design_system,
      notifications: parsed.notifications,
      imports: parsed.imports,
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
      transformed.workflows ??= []
      for (const [workflowName, workflowDef] of Object.entries(parsed.workflow)) {
        transformed.workflows.push({
          name: workflowName,
          ...(workflowDef as any),
        })
      }
    }

    // Handle first-class domain commands.
    if (parsed.command) {
      transformed.commands ??= []
      for (const [commandName, commandDef] of Object.entries(parsed.command)) {
        transformed.commands.push({
          name: commandName,
          ...(commandDef as any),
        })
      }
    }

    // Handle [services.<name>] and [service.<name>] declarations.
    const serviceDefinitions = Array.isArray(parsed.services) ? parsed.service : (parsed.services ?? parsed.service)
    if (serviceDefinitions && !Array.isArray(serviceDefinitions)) {
      transformed.services ??= []
      for (const [serviceName, serviceDef] of Object.entries(serviceDefinitions)) {
        transformed.services.push({
          name: serviceName,
          ...(serviceDef as any),
        })
      }
    }

    // Handle plugins if present
    if (parsed.plugin) {
      transformed.plugins ??= []
      for (const [pluginName, pluginDef] of Object.entries(parsed.plugin)) {
        transformed.plugins.push({
          name: pluginName,
          ...(pluginDef as any),
        })
      }
    }

    // Handle skills if present
    if (parsed.skill) {
      transformed.skills ??= []
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
  private validateReferences(
    blueprint: Blueprint,
    file?: string,
    sourceFor?: (kind: string, identity: string) => string | undefined,
  ): void {
    const entityNames = new Set(blueprint.entities.map((e) => e.name))
    const errors: string[] = []

    const validatePolicy = (label: string, condition: any) => {
      try {
        validatePolicyCondition(condition)
      } catch (error) {
        errors.push(`${label} has an invalid expression: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const seenCommands = new Set<string>()
    for (const command of blueprint.commands ?? []) {
      if (seenCommands.has(command.name)) {
        errors.push(`Duplicate command definition "${command.name}"`)
      }
      seenCommands.add(command.name)
      if (!entityNames.has(command.entity)) {
        errors.push(`Command "${command.name}" references unknown entity "${command.entity}"`)
      }
      const target = blueprint.entities.find(entity => entity.name === command.entity)
      const targetFields = new Set(target?.fields.map(field => field.name) ?? [])
      for (const fieldName of Object.keys(command.mutations ?? {})) {
        if (!targetFields.has(fieldName)) {
          errors.push(`Command "${command.name}" mutates unknown field "${command.entity}.${fieldName}"`)
        }
      }
      validatePolicy(`Command "${command.name}" policy`, command.policy)
    }

    const commandNames = new Set((blueprint.commands ?? []).map(command => command.name))
    const services = new Map<string, Set<string>>()
    for (const service of blueprint.services ?? []) {
      if (services.has(service.name)) errors.push(`Duplicate service definition "${service.name}"`)
      services.set(service.name, new Set(Object.keys(service.operations)))
    }
    const validateWorkflowSteps = (workflowName: string, steps: Array<Record<string, any>>) => {
      for (const step of steps) {
        if (step.type === 'command') {
          if (typeof step.command !== 'string' || !commandNames.has(step.command)) {
            errors.push(`Workflow "${workflowName}" references unknown command "${String(step.command)}"`)
          }
          if (typeof step.recordId !== 'string' || step.recordId.length === 0) {
            errors.push(`Workflow "${workflowName}" command step requires recordId`)
          }
        }
        if (step.type === 'service') {
          const operations = typeof step.service === 'string' ? services.get(step.service) : undefined
          if (!operations) {
            errors.push(`Workflow "${workflowName}" references unknown service "${String(step.service)}"`)
          } else if (typeof step.operation !== 'string' || !operations.has(step.operation)) {
            errors.push(`Workflow "${workflowName}" references unknown service operation "${String(step.service)}.${String(step.operation)}"`)
          }
        }
        if (Array.isArray(step.then)) validateWorkflowSteps(workflowName, step.then)
        if (Array.isArray(step.else)) validateWorkflowSteps(workflowName, step.else)
        if (Array.isArray(step.do)) validateWorkflowSteps(workflowName, step.do)
      }
    }
    for (const workflow of blueprint.workflows ?? []) {
      validateWorkflowSteps(workflow.name, workflow.steps)
    }
    for (const entity of blueprint.entities) {
      const fieldNames = new Set(entity.fields.map(field => field.name))
      for (const [action, condition] of Object.entries(entity.access ?? {})) {
        validatePolicy(`Entity "${entity.name}" ${action} access`, condition)
      }
      for (const fieldName of entity.protection?.fields ?? []) {
        if (!fieldNames.has(fieldName)) {
          errors.push(`Entity "${entity.name}" protects unknown field "${fieldName}"`)
        }
      }
      for (const commandName of entity.protection?.commands ?? []) {
        if (!commandNames.has(commandName)) {
          errors.push(`Entity "${entity.name}" protection references unknown command "${commandName}"`)
        } else if (blueprint.commands?.find(command => command.name === commandName)?.entity !== entity.name) {
          errors.push(`Entity "${entity.name}" protection references command "${commandName}" for another entity`)
        }
      }
      for (const field of entity.fields) {
        for (const [action, condition] of Object.entries(field.access ?? {})) {
          validatePolicy(`Field "${entity.name}.${field.name}" ${action} access`, condition)
        }
        for (const commandName of field.commands ?? []) {
          if (!commandNames.has(commandName)) {
            errors.push(`Field "${entity.name}.${field.name}" references unknown command "${commandName}"`)
          } else if (blueprint.commands?.find(command => command.name === commandName)?.entity !== entity.name) {
            errors.push(`Field "${entity.name}.${field.name}" references command "${commandName}" for another entity`)
          }
        }
      }
    }
    for (const [role, rule] of Object.entries(blueprint.auth?.permissions ?? {})) {
      for (const condition of rule.allow) {
        if (typeof condition !== 'string') {
          validatePolicy(`Role "${role}" permission for ${condition.entity}`, condition.condition)
        }
      }
    }

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

        for (const field of page.form.fields) {
          const source = field.optionsFrom
          if (!source) continue

          if (field.type !== 'select') {
            errors.push(
              `Page "${page.path}" form field "${field.name}" uses optionsFrom but is not a select`
            )
          }

          const query = page.queries?.[source.query]
          if (!query) {
            errors.push(
              `Page "${page.path}" form field "${field.name}" optionsFrom references unknown query "${source.query}"`
            )
            continue
          }

          const queryEntity = blueprint.entities.find((entity) => entity.name === query.entity)
          if (!queryEntity) continue

          const entityFields = new Set(queryEntity.fields.map((entityField) => entityField.name))
          for (const optionField of [source.value || 'id', source.label]) {
            if (!entityFields.has(optionField)) {
              errors.push(
                `Page "${page.path}" form field "${field.name}" optionsFrom references unknown field "${query.entity}.${optionField}"`
              )
            }
          }
        }
      }

      if (page.layout === 'board' && !page.board) {
        errors.push(`Page "${page.path}" uses the board layout without board configuration`)
      }

      if (page.board) {
        const board = page.board
        const query = page.queries?.[board.query]
        if (!query) {
          errors.push(
            `Page "${page.path}" board references unknown query "${board.query}"`
          )
        } else {
          const entity = blueprint.entities.find((candidate) => candidate.name === query.entity)
          if (entity) {
            const fieldNames = new Set(entity.fields.map((field) => field.name))
            for (const fieldPath of [board.groupBy, board.orderBy, board.card.title, board.card.description].filter(Boolean) as string[]) {
              const root = fieldPath.split('.')[0] ?? fieldPath
              if (!fieldNames.has(root)) {
                errors.push(
                  `Page "${page.path}" board references unknown field "${entity.name}.${root}"`
                )
              }
            }

            for (const displayPath of board.card.fields || []) {
              const [root = '', nested] = displayPath.split('.')
              if (!nested) {
                if (!fieldNames.has(root)) {
                  errors.push(
                    `Page "${page.path}" board references unknown field "${entity.name}.${root}"`
                  )
                }
                continue
              }

              const relation = entity.relations?.[root]
              const relatedEntity = relation
                ? blueprint.entities.find((candidate) => candidate.name === relation.entity)
                : undefined
              if (!relation || !relatedEntity?.fields.some((field) => field.name === nested)) {
                errors.push(
                  `Page "${page.path}" board references unknown field path "${entity.name}.${displayPath}"`
                )
              }
            }
          }
        }

        if (board.move) {
          const workflowNames = new Set((blueprint.workflows || []).map((workflow) => workflow.name))
          if (!workflowNames.has(board.move.workflow)) {
            errors.push(
              `Page "${page.path}" board move references unknown workflow "${board.move.workflow}"`
            )
          }
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
        if (workflow.transactional) {
          const analysis = analyzeTransactionalWorkflow(workflow)
          if (!analysis.databaseOnly) {
            errors.push(
              `Transactional workflow "${workflow.name}" must contain only database query steps: ${analysis.reasons.join('; ')}`
            )
          }
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
      const contextualErrors = sourceFor
        ? errors.map(error => {
            const definition = error.match(/^(Command|Workflow|Entity|Field|Page|Skill) "([^"]+)/)
            if (!definition?.[1] || !definition[2]) return error
            const kind = definition[1].toLowerCase()
            const identity = kind === 'field' ? definition[2].split('.')[0]! : definition[2]
            const location = sourceFor(kind === 'field' ? 'entity' : kind, identity)
            return location ? `${location}: ${error}` : error
          })
        : errors
      throw createReferenceError(contextualErrors, file)
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
