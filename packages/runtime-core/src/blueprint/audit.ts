import type { Blueprint } from '../types/blueprint.js'

export type AuditSeverity = 'error' | 'warning' | 'info'

export interface AuditFinding {
  ruleId: string
  severity: AuditSeverity
  /** Segments address the composed blueprint, including array indexes. */
  path: Array<string | number>
  message: string
  suggestion: string
}

export interface BlueprintAuditReport {
  /** Bump when the report format or rule semantics change. */
  version: 1
  findings: AuditFinding[]
  summary: Record<AuditSeverity, number>
}

/**
 * Inspect an already validated, composed blueprint. No I/O, execution, environment
 * inspection, or model calls. Findings describe declarations, not proven exploits.
 */
export function auditBlueprint(blueprint: Blueprint): BlueprintAuditReport {
  const findings: AuditFinding[] = []
  const add = (ruleId: string, severity: AuditSeverity, path: AuditFinding['path'], message: string, suggestion: string): void => {
    findings.push({ ruleId, severity, path, message, suggestion })
  }

  blueprint.entities.forEach((entity, index) => {
    const path = ['entities', index]
    const missing = (['read', 'create', 'update', 'delete'] as const)
      .filter(action => entity.access?.[action] === undefined)
    if (missing.length) {
      add('access.implicit', 'warning', [...path, 'access'],
        `Entity "${entity.name}" has no explicit ${missing.join(', ')} access rule. Omitted entity rules allow access at the policy layer; other authorization may still restrict it.`,
        'Declare access rules for every operation to make the intended boundary explicit.')
    }
    for (const action of ['create', 'update', 'delete'] as const) {
      const condition = entity.access?.[action]
      if (condition === true || condition === 'public') {
        add('access.public-mutation', 'warning', [...path, 'access', action],
          `Entity "${entity.name}" explicitly permits public ${action} at the entity policy layer. Other authorization may still restrict it.`,
          'Confirm public writes are intentional, or require an authenticated actor or scoped policy.')
      }
    }
    entity.fields.forEach((field, fieldIndex) => {
      if (field.type === 'Ref' && !field.primary_key && !field.unique && !field.index &&
          !entity.indexes?.some(index => index.fields[0] === field.name)) {
        add('performance.reference-index', 'info', [...path, 'fields', fieldIndex],
          `Reference "${entity.name}.${field.name}" has no declared index with this field first.`,
          'Consider an index if this reference is used for joins or filtering; inspect actual query plans.')
      }
    })
  })

  blueprint.pages.forEach((page, pageIndex) => {
    for (const name of Object.keys(page.queries ?? {}).sort()) {
      const query = page.queries![name]!
      const path = ['pages', pageIndex, 'queries', name]
      if (query.limit === undefined || query.limit <= 0) {
        add('query.unbounded', 'warning', path,
          `Page "${page.path}" query "${name}" has no explicit positive result limit.`,
          'Set a limit appropriate for the view to bound work as the dataset grows.')
      }
      if (query.offset !== undefined && !Object.keys(query.orderBy ?? {}).length) {
        add('query.offset-without-order', 'warning', path,
          `Page "${page.path}" query "${name}" uses an offset without explicit ordering.`,
          'Declare a stable order, including a unique tie breaker, before paginating.')
      }
    }
  })

  blueprint.workflows?.forEach((workflow, index) => {
    if (workflow.enabled === false) return
    if (workflow.trigger.webhook && !workflow.trigger.webhookSecretEnv) {
      add('workflow.webhook-default-secret', 'info', ['workflows', index, 'trigger'],
        `Webhook workflow "${workflow.name}" relies on the default ZEBRIC_WEBHOOK_SECRET environment variable. Its deployment value cannot be verified statically.`,
        'Configure the default signing secret in deployment, or declare a dedicated webhookSecretEnv.')
    }
    const trigger = workflow.trigger
    if (!trigger.manual && !trigger.webhook && !trigger.schedule && !(trigger.entity && trigger.event)) {
      add('workflow.no-trigger', 'warning', ['workflows', index, 'trigger'],
        `Enabled workflow "${workflow.name}" has no manual, webhook, schedule, or complete entity/event trigger.`,
        'Declare a trigger or disable the workflow if it is intentionally inactive.')
    }
  })

  blueprint.plugins?.forEach((plugin, index) => {
    if (plugin.enabled && plugin.trust_level === 'full') {
      add('plugin.full-trust', 'warning', ['plugins', index, 'trust_level'],
        `Plugin "${plugin.name}" is enabled with full trust.`,
        'Review the plugin and its capabilities; prefer limited trust when possible.')
    }
  })

  // Code-unit comparison avoids locale-dependent ordering across machines.
  findings.sort((a, b) => {
    const left = JSON.stringify([a.ruleId, a.path])
    const right = JSON.stringify([b.ruleId, b.path])
    return left < right ? -1 : left > right ? 1 : 0
  })
  const summary = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) summary[finding.severity]++
  return { version: 1, findings, summary }
}
