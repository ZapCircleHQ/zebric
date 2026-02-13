/**
 * Workflow Executor
 *
 * Executes workflow steps and manages workflow lifecycle
 */

import type {
  Workflow,
  WorkflowStep,
  WorkflowContext,
  WorkflowExecutionResult,
  WorkflowLog,
} from './types.js'
import type { QueryExecutor } from '../database/query-executor.js'
import type { NotificationManager } from '@zebric/notifications'

export interface EmailService {
  send(to: string, subject: string, body: string, template?: string): Promise<void>
}

export interface HttpClient {
  request(url: string, options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
    body?: any
  }): Promise<any>
}

export interface WorkflowExecutorOptions {
  dataLayer: QueryExecutor
  pluginRegistry?: any
  emailService?: EmailService
  httpClient?: HttpClient
  notificationService?: NotificationManager
  onEntityEvent?: (event: {
    entity: string
    event: 'create' | 'update' | 'delete'
    before?: any
    after?: any
    sourceWorkflow: string
    depth: number
  }) => Promise<void>
}

export class WorkflowExecutor {
  private dataLayer: QueryExecutor
  private pluginRegistry?: any
  private emailService?: EmailService
  private httpClient?: HttpClient
  private notificationService?: NotificationManager
  private onEntityEvent?: WorkflowExecutorOptions['onEntityEvent']

  constructor(options: WorkflowExecutorOptions) {
    this.dataLayer = options.dataLayer
    this.pluginRegistry = options.pluginRegistry
    this.emailService = options.emailService
    this.httpClient = options.httpClient
    this.notificationService = options.notificationService
    this.onEntityEvent = options.onEntityEvent
  }

  /**
   * Execute a workflow
   */
  async execute(workflow: Workflow, context: WorkflowContext): Promise<WorkflowExecutionResult> {
    const logs: WorkflowLog[] = []

    const log = (level: WorkflowLog['level'], message: string, data?: any) => {
      logs.push({
        timestamp: new Date(),
        level,
        message,
        data,
      })
    }

    try {
      log('info', `Starting workflow: ${workflow.name}`)

      // Initialize context variables if not present
      if (!context.variables) {
        context.variables = {}
      }

      // Execute steps sequentially
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i]
        if (!step) continue

        log('debug', `Executing step ${i + 1}/${workflow.steps.length}: ${step.type}`)

        try {
          const result = await this.executeStep(step, context)

          // Assign result to context variable if specified
          if (step.assignTo && result !== undefined) {
            context.variables[step.assignTo] = result
            log('debug', `Assigned result to variable: ${step.assignTo}`, result)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          log('error', `Step ${i + 1} failed: ${errorMessage}`, error)
          throw error
        }
      }

      log('info', `Workflow completed: ${workflow.name}`)

      return {
        success: true,
        result: context.variables,
        logs,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log('error', `Workflow failed: ${errorMessage}`, error)

      return {
        success: false,
        error: errorMessage,
        logs,
      }
    }
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    switch (step.type) {
      case 'query':
        return this.executeQuery(step, context)

      case 'email':
        return this.executeEmail(step, context)

      case 'webhook':
        return this.executeWebhook(step, context)

      case 'plugin':
        return this.executePlugin(step, context)

      case 'condition':
        return this.executeCondition(step, context)

      case 'loop':
        return this.executeLoop(step, context)

      case 'delay':
        return this.executeDelay(step, context)

      case 'notify':
        return this.executeNotify(step, context)

      default:
        throw new Error(`Unknown step type: ${(step as any).type}`)
    }
  }

  /**
   * Execute a query step
   */
  private async executeQuery(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!step.entity) {
      throw new Error('Query step requires entity')
    }

    if (!step.action) {
      throw new Error('Query step requires action')
    }

    // Resolve variables in data and where clauses
    const data = step.data ? this.resolveVariables(step.data, context) : undefined
    const where = step.where ? this.resolveVariables(step.where, context) : undefined

    switch (step.action) {
      case 'create':
        if (!data) {
          throw new Error('Create action requires data')
        }
        {
          const created = await this.dataLayer.create(step.entity, data)
          await this.emitEntityEvent(step.entity, 'create', undefined, created, context)
          return created
        }

      case 'update':
        if (!data) {
          throw new Error('Update action requires data')
        }
        {
          const targetId = this.extractIdFromWhere(where)
          if (!targetId) {
            throw new Error('Update action requires an id in the where clause')
          }
          const before = await this.dataLayer.findById(step.entity, targetId)
          const updated = await this.dataLayer.update(step.entity, targetId, data)
          await this.emitEntityEvent(step.entity, 'update', before, updated, context)
          return updated
        }

      case 'delete':
        {
          const targetId = this.extractIdFromWhere(where)
          if (!targetId) {
            throw new Error('Delete action requires an id in the where clause')
          }
          const before = await this.dataLayer.findById(step.entity, targetId)
          await this.dataLayer.delete(step.entity, targetId)
          await this.emitEntityEvent(step.entity, 'delete', before || { id: targetId }, undefined, context)
          return { deleted: true }
        }

      case 'find':
        return this.dataLayer.execute({
          entity: step.entity,
          where,
        })

      default:
        throw new Error(`Unknown query action: ${step.action}`)
    }
  }

  /**
   * Execute an email step
   */
  private async executeEmail(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    if (!this.emailService) {
      throw new Error('Email service not configured')
    }

    if (!step.to) {
      throw new Error('Email step requires to')
    }

    if (!step.subject) {
      throw new Error('Email step requires subject')
    }

    const to = this.resolveVariables(step.to, context)
    const subject = this.resolveVariables(step.subject, context)
    const body = step.body ? this.resolveVariables(step.body, context) : ''
    const template = step.template

    await this.emailService.send(to, subject, body, template)
  }

  /**
   * Execute a webhook step
   */
  private async executeWebhook(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!this.httpClient) {
      throw new Error('HTTP client not configured')
    }

    if (!step.url) {
      throw new Error('Webhook step requires url')
    }

    const url = this.resolveVariables(step.url, context)
    const method = step.method || 'POST'
    const headers = step.headers ? this.resolveVariables(step.headers, context) : {}
    const body = step.payload ? this.resolveVariables(step.payload, context) : undefined

    return this.httpClient.request(url, { method, headers, body })
  }

  /**
   * Execute a notification step
   */
  private async executeNotify(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    if (!this.notificationService) {
      throw new Error('Notification service not configured')
    }

    const channel = step.channel ? this.resolveVariables(step.channel, context) : undefined
    const to = step.to ? this.resolveVariables(step.to, context) : undefined
    const subject = step.subject ? this.resolveVariables(step.subject, context) : undefined
    const body = step.body ? this.resolveVariables(step.body, context) : undefined
    const params = step.params ? this.resolveVariables(step.params, context) : undefined
    const metadata = step.metadata ? this.resolveVariables(step.metadata, context) : undefined

    await this.notificationService.send({
      adapter: step.adapter,
      channel,
      to,
      subject,
      body,
      template: step.template,
      params,
      metadata,
    })
  }

  /**
   * Execute a plugin step
   */
  private async executePlugin(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!this.pluginRegistry) {
      throw new Error('Plugin registry not configured')
    }

    if (!step.plugin) {
      throw new Error('Plugin step requires plugin')
    }

    if (!step.action_name) {
      throw new Error('Plugin step requires action_name')
    }

    const params = step.params ? this.resolveVariables(step.params, context) : {}

    // Get the plugin
    const plugin = this.pluginRegistry.getPlugin(step.plugin)
    if (!plugin) {
      throw new Error(`Plugin not found: ${step.plugin}`)
    }

    // Execute the action
    if (plugin.actions && typeof plugin.actions === 'object') {
      const action = (plugin.actions as any)[step.action_name]
      if (typeof action === 'function') {
        return action(params, context)
      }
    }

    throw new Error(`Action not found: ${step.plugin}.${step.action_name}`)
  }

  /**
   * Execute a condition step
   */
  private async executeCondition(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!step.if) {
      throw new Error('Condition step requires if clause')
    }

    const condition = this.evaluateCondition(step.if, context)

    if (condition) {
      // Execute then branch
      if (step.then) {
        for (const subStep of step.then) {
          await this.executeStep(subStep, context)
        }
      }
    } else {
      // Execute else branch
      if (step.else) {
        for (const subStep of step.else) {
          await this.executeStep(subStep, context)
        }
      }
    }
  }

  /**
   * Execute a loop step
   */
  private async executeLoop(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!step.items) {
      throw new Error('Loop step requires items')
    }

    if (!step.do) {
      throw new Error('Loop step requires do')
    }

    // Get items from context
    const items = this.resolveVariables(step.items, context)

    if (!Array.isArray(items)) {
      throw new Error(`Loop items must be an array, got: ${typeof items}`)
    }

    // Execute steps for each item
    const results = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      // Create a new context with the current item
      const loopContext: WorkflowContext = {
        ...context,
        variables: {
          ...context.variables,
          item,
          index: i,
        },
      }

      // Execute loop body
      for (const subStep of step.do) {
        const result = await this.executeStep(subStep, loopContext)
        results.push(result)
      }
    }

    return results
  }

  /**
   * Execute a delay step
   */
  private async executeDelay(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    if (!step.duration) {
      throw new Error('Delay step requires duration')
    }

    const duration = typeof step.duration === 'number'
      ? step.duration
      : parseInt(this.resolveVariables(step.duration, context), 10)

    if (isNaN(duration) || duration < 0) {
      throw new Error(`Invalid delay duration: ${step.duration}`)
    }

    await new Promise(resolve => setTimeout(resolve, duration))
  }

  /**
   * Resolve variables in a value using context
   */
  private resolveVariables(value: any, context: WorkflowContext): any {
    if (typeof value === 'string') {
      // Replace {{variable}} patterns
      return value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const resolved = this.getValueByPath(context, path.trim())
        return resolved !== undefined ? String(resolved) : match
      })
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveVariables(item, context))
    }

    if (value && typeof value === 'object') {
      const resolved: Record<string, any> = {}
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveVariables(val, context)
      }
      return resolved
    }

    return value
  }

  private extractIdFromWhere(where: any): string | undefined {
    if (!where) {
      return undefined
    }

    if (typeof where === 'string') {
      return where
    }

    if (typeof where === 'object' && where.id !== undefined && where.id !== null) {
      return String(where.id)
    }

    return undefined
  }

  private async emitEntityEvent(
    entity: string,
    event: 'create' | 'update' | 'delete',
    before: any,
    after: any,
    context: WorkflowContext
  ): Promise<void> {
    if (!this.onEntityEvent) {
      return
    }

    const depth = Number((context.variables as any)?.__zebric?.depth || 0)
    const sourceWorkflow = String((context.variables as any)?.__zebric?.sourceWorkflow || 'unknown')

    await this.onEntityEvent({
      entity,
      event,
      before,
      after,
      sourceWorkflow,
      depth
    })
  }

  /**
   * Get value from context by path (e.g., "variables.user.email")
   */
  private getValueByPath(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(condition: Record<string, any>, context: WorkflowContext): boolean {
    // Simple condition evaluation
    // Supports: { "field": "value" } for equality
    // Supports: { "field": { "$eq": "value" } } for explicit equality
    // Supports: { "field": { "$ne": "value" } } for inequality
    // Supports: { "field": { "$gt": 5 } } for greater than
    // Supports: { "field": { "$lt": 5 } } for less than
    // Supports: { "$and": [ ... ] } for AND conditions
    // Supports: { "$or": [ ... ] } for OR conditions

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$and') {
        if (!Array.isArray(value)) {
          return false
        }
        return value.every((cond) => this.evaluateCondition(cond, context))
      }

      if (key === '$or') {
        if (!Array.isArray(value)) {
          return false
        }
        return value.some((cond) => this.evaluateCondition(cond, context))
      }

      // Get value from context
      const actualValue = this.getValueByPath(context, key)

      // Handle operators
      if (value && typeof value === 'object') {
        for (const [op, expected] of Object.entries(value)) {
          switch (op) {
            case '$eq':
              if (actualValue !== expected) return false
              break
            case '$ne':
              if (actualValue === expected) return false
              break
            case '$gt':
              if (!(actualValue > (expected as any))) return false
              break
            case '$gte':
              if (!(actualValue >= (expected as any))) return false
              break
            case '$lt':
              if (!(actualValue < (expected as any))) return false
              break
            case '$lte':
              if (!(actualValue <= (expected as any))) return false
              break
            default:
              throw new Error(`Unknown operator: ${op}`)
          }
        }
      } else {
        // Direct equality
        if (actualValue !== value) {
          return false
        }
      }
    }

    return true
  }
}
