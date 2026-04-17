import type { Blueprint, WorkflowStep } from '@zebric/runtime-core'
import { createSimulatorId } from './id.js'
import type { SimulatorLogger } from './logger.js'
import type { SimulatedIntegrationEntry, SimulatedIntegrationKind } from './types.js'

interface WorkflowSimulationContext {
  trigger: Record<string, unknown>
  variables: Record<string, unknown>
}

interface WorkflowSimulationOptions {
  context?: WorkflowSimulationContext
}

export class SimulatorIntegrationHost {
  private entries: SimulatedIntegrationEntry[] = []

  constructor(
    private blueprint: Blueprint,
    private logger: SimulatorLogger
  ) {}

  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
  }

  simulateWorkflow(workflowName: string, payload?: unknown, options: WorkflowSimulationOptions = {}): SimulatedIntegrationEntry[] {
    const workflow = this.blueprint.workflows?.find((candidate) => candidate.name === workflowName)
    if (!workflow) {
      return []
    }

    const context = options.context || this.createContext(payload)
    const simulated = workflow.steps
      .map((step, index) => this.simulateStep(workflowName, index, step, context))
      .filter((entry): entry is SimulatedIntegrationEntry => Boolean(entry))

    if (simulated.length === 0) {
      return []
    }

    this.entries = [...simulated, ...this.entries].slice(0, 200)

    for (const entry of simulated) {
      this.logger.log({
        type: 'integration',
        message: entry.message,
        detail: entry,
      })
    }

    return simulated
  }

  getEntries(): SimulatedIntegrationEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  private simulateStep(
    workflowName: string,
    stepIndex: number,
    step: WorkflowStep,
    context: WorkflowSimulationContext
  ): SimulatedIntegrationEntry | null {
    if (step.type === 'email') {
      return this.createEmailEntry(workflowName, stepIndex, step, context)
    }

    if (step.type === 'webhook') {
      return this.createWebhookEntry(workflowName, stepIndex, step, context)
    }

    if (step.type === 'notify') {
      return this.createNotificationEntry(workflowName, stepIndex, step, context)
    }

    return null
  }

  private createEmailEntry(
    workflowName: string,
    stepIndex: number,
    step: WorkflowStep,
    context: WorkflowSimulationContext
  ): SimulatedIntegrationEntry {
    const to = this.optionalString(this.resolveVariables(step.to, context))
    const subject = this.optionalString(this.resolveVariables(step.subject, context))
    const body = this.optionalString(step.body ? this.resolveVariables(step.body, context) : '')

    return {
      id: createSimulatorId('integration'),
      timestamp: Date.now(),
      kind: 'email',
      workflowName,
      stepIndex,
      status: to && subject ? 'simulated' : 'failed',
      to,
      subject,
      body,
      template: this.optionalString(step.template),
      message: to && subject
        ? `Email simulated to ${to}`
        : `Email step ${stepIndex + 1} missing ${to ? 'subject' : 'recipient'}`,
    }
  }

  private createWebhookEntry(
    workflowName: string,
    stepIndex: number,
    step: WorkflowStep,
    context: WorkflowSimulationContext
  ): SimulatedIntegrationEntry {
    const url = this.optionalString(this.resolveVariables(step.url, context))
    const method = this.optionalString(this.resolveVariables(step.method || 'POST', context)) || 'POST'
    const headers = step.headers ? this.resolveVariables(step.headers, context) : {}
    const payload = step.payload ? this.resolveVariables(step.payload, context) : undefined

    return {
      id: createSimulatorId('integration'),
      timestamp: Date.now(),
      kind: 'webhook',
      workflowName,
      stepIndex,
      status: url ? 'simulated' : 'failed',
      url,
      method,
      headers: this.stringifyRecord(headers),
      payload,
      message: url
        ? `Webhook simulated: ${method.toUpperCase()} ${url}`
        : `Webhook step ${stepIndex + 1} missing url`,
    }
  }

  private createNotificationEntry(
    workflowName: string,
    stepIndex: number,
    step: WorkflowStep,
    context: WorkflowSimulationContext
  ): SimulatedIntegrationEntry {
    const adapter = this.optionalString(step.adapter) || this.blueprint.notifications?.default
    const adapterConfig = this.blueprint.notifications?.adapters.find((candidate) => candidate.name === adapter)
    const adapterType = adapterConfig?.type || adapter
    const kind = this.integrationKind(adapterType)
    const channel = this.optionalString(step.channel ? this.resolveVariables(step.channel, context) : undefined)
    const to = this.optionalString(step.to ? this.resolveVariables(step.to, context) : undefined)
    const subject = this.optionalString(step.subject ? this.resolveVariables(step.subject, context) : undefined)
    const body = this.optionalString(step.body ? this.resolveVariables(step.body, context) : undefined)
    const params = step.params ? this.resolveVariables(step.params, context) : undefined
    const metadata = step.metadata ? this.resolveVariables(step.metadata, context) : undefined

    return {
      id: createSimulatorId('integration'),
      timestamp: Date.now(),
      kind,
      workflowName,
      stepIndex,
      status: adapter ? 'simulated' : 'failed',
      adapter,
      adapterType,
      channel,
      to,
      subject,
      body,
      template: this.optionalString(step.template),
      params,
      metadata,
      message: adapter
        ? `${this.kindLabel(kind)} notification simulated via ${adapter}`
        : `Notify step ${stepIndex + 1} missing adapter`,
    }
  }

  private createContext(payload?: unknown): WorkflowSimulationContext {
    const variables = payload && typeof payload === 'object'
      ? { ...(payload as Record<string, unknown>), payload }
      : { payload }

    return {
      trigger: {
        type: 'manual',
        data: payload,
        payload,
      },
      variables,
    }
  }

  private resolveVariables(value: any, context: WorkflowSimulationContext): any {
    if (typeof value === 'string') {
      return value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const resolved = this.resolveTemplateValue(context, path.trim())
        return resolved !== undefined ? this.formatTemplateValue(resolved) : match
      })
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveVariables(item, context))
    }

    if (value && typeof value === 'object') {
      const resolved: Record<string, any> = {}
      for (const [key, item] of Object.entries(value)) {
        resolved[key] = this.resolveVariables(item, context)
      }
      return resolved
    }

    return value
  }

  private resolveTemplateValue(context: WorkflowSimulationContext, path: string): any {
    const resolved = this.getValueByPath(context, path)
    if (resolved !== undefined) {
      return resolved
    }

    for (const suffix of ['.value', '.label', '.id']) {
      if (!path.endsWith(suffix)) {
        continue
      }

      const baseValue = this.getValueByPath(context, path.slice(0, -suffix.length))
      if (baseValue === undefined) {
        continue
      }

      if (baseValue && typeof baseValue === 'object') {
        const direct = (baseValue as Record<string, unknown>)[suffix.slice(1)]
        if (direct !== undefined && direct !== null) {
          return direct
        }
      }

      return baseValue
    }

    return undefined
  }

  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, part) => {
      if (current === undefined || current === null) {
        return undefined
      }
      return current[part]
    }, obj)
  }

  private formatTemplateValue(value: any): string {
    const primitive = this.extractPrimitiveValue(value)
    if (primitive === undefined || primitive === null) {
      return ''
    }
    return String(primitive)
  }

  private extractPrimitiveValue(value: any, depth = 0): any {
    if (depth > 8 || value === null || value === undefined) {
      return value
    }

    const valueType = typeof value
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
      return value
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const extracted = this.extractPrimitiveValue(item, depth + 1)
        if (extracted !== undefined && extracted !== null) {
          return extracted
        }
      }
      return undefined
    }

    if (valueType === 'object') {
      for (const key of ['value', 'label', 'text', 'name', 'title', 'id']) {
        if (key in value) {
          const extracted = this.extractPrimitiveValue(value[key], depth + 1)
          if (extracted !== undefined && extracted !== null) {
            return extracted
          }
        }
      }

      for (const item of Object.values(value)) {
        const extracted = this.extractPrimitiveValue(item, depth + 1)
        if (extracted !== undefined && extracted !== null) {
          return extracted
        }
      }

      return JSON.stringify(value)
    }

    return String(value)
  }

  private integrationKind(adapterType?: string): SimulatedIntegrationKind {
    if (adapterType === 'slack') return 'slack'
    if (adapterType === 'email') return 'email'
    return 'notification'
  }

  private kindLabel(kind: SimulatedIntegrationKind): string {
    if (kind === 'slack') return 'Slack'
    if (kind === 'email') return 'Email'
    if (kind === 'webhook') return 'Webhook'
    return 'Notification'
  }

  private optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined
    }
    return String(value)
  }

  private stringifyRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.optionalString(item) ?? ''])
    )
  }
}
