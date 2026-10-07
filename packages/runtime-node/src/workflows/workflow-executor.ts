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
import { createWorkflowLogger, type Logger } from '@zebric/observability'
import { evaluateCondition as evaluateWorkflowCondition } from '@zebric/runtime-core'
import {
  DomainError,
  ServiceFailureError,
  WorkflowFailureError,
  type CommandExecutor,
  type ExecutionObserverPort,
  type ServiceInvoker,
} from '@zebric/runtime-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { encodeRuntimeValue, decodeRuntimeValue } from '../database/runtime-codec.js'
import type { WorkflowStepRunner } from './step-runner.js'
import { wait } from './step-runner.js'
import { WorkflowSuspended, WorkflowLeaseLostError } from './workflow-store.js'

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
  commandExecutor?: CommandExecutor
  executionObserver?: ExecutionObserverPort
  services?: ServiceInvoker
  logger?: Logger
  enqueueEntityEvent?: (event: Parameters<NonNullable<WorkflowExecutorOptions['onEntityEvent']>>[0], id: string) => Promise<void>
  onEntityEvent?: (event: {
    entity: string
    event: 'create' | 'update' | 'delete'
    before?: any
    after?: any
    sourceWorkflow: string
    depth: number
    workflowPath: string[]
    trace?: WorkflowContext['trace']
    session?: WorkflowContext['session']
    attribution?: any
  }) => Promise<void>
}

export class WorkflowExecutor {
  private dataLayer: QueryExecutor
  private pluginRegistry?: any
  private emailService?: EmailService
  private httpClient?: HttpClient
  private notificationService?: NotificationManager
  private commandExecutor?: CommandExecutor
  private executionObserver?: ExecutionObserverPort
  private services?: ServiceInvoker
  private logger?: Logger
  private onEntityEvent?: WorkflowExecutorOptions['onEntityEvent']
  private readonly executionScope = new AsyncLocalStorage<{
    runner?: WorkflowStepRunner; signal?: AbortSignal; workflow: Workflow; path: string; atomic: boolean
    log: (level: WorkflowLog['level'], message: string, data?: any) => void
  }>()
  private enqueueEntityEvent?: WorkflowExecutorOptions['enqueueEntityEvent']
  private readonly deferredEntityEvents = new AsyncLocalStorage<Array<Parameters<NonNullable<WorkflowExecutorOptions['onEntityEvent']>>[0]>>()

  constructor(options: WorkflowExecutorOptions) {
    this.dataLayer = options.dataLayer
    this.pluginRegistry = options.pluginRegistry
    this.emailService = options.emailService
    this.httpClient = options.httpClient
    this.notificationService = options.notificationService
    this.commandExecutor = options.commandExecutor
    this.executionObserver = options.executionObserver
    this.services = options.services
    this.logger = options.logger
    this.onEntityEvent = options.onEntityEvent
    this.enqueueEntityEvent = options.enqueueEntityEvent
  }

  setCommandExecutor(commandExecutor: CommandExecutor, executionObserver?: ExecutionObserverPort): void {
    this.commandExecutor = commandExecutor
    if (executionObserver) this.executionObserver = executionObserver
  }

  /**
   * Execute a workflow
   */
  async execute(
    workflow: Workflow,
    context: WorkflowContext,
    options?: { beforeTransactionalCommit?: () => Promise<void>; runner?: WorkflowStepRunner; signal?: AbortSignal }
  ): Promise<WorkflowExecutionResult> {
    const logs: WorkflowLog[] = []
    const workflowSpan = this.executionObserver?.startSpan('zebric.workflow', {
      'zebric.workflow.name': workflow.name,
      'zebric.workflow.trigger': context.trigger.type,
    }, context.trace?.correlationId ?? context.trace?.executionId)
    const workflowLogger = this.logger
      ? createWorkflowLogger(this.logger, workflow.name, {
          correlationId: context.trace?.correlationId,
          requestId: context.trace?.requestId,
          executionId: context.trace?.executionId,
          triggerType: context.trigger.type,
        })
      : undefined

    const log = (level: WorkflowLog['level'], message: string, data?: any) => {
      logs.push({
        timestamp: new Date(),
        level,
        message,
        data,
      })

      if (!workflowLogger) {
        return
      }

      const logContext = data !== undefined ? { data } : undefined
      switch (level) {
        case 'debug':
          workflowLogger.debug(message, logContext)
          break
        case 'info':
          workflowLogger.info(message, logContext)
          break
        case 'warn':
          workflowLogger.warn(message, logContext)
          break
        case 'error':
          workflowLogger.error(message, {
            error: data,
          })
          break
      }
    }

    try {
      log('info', `Starting workflow: ${workflow.name}`)

      // Initialize context variables if not present
      if (!context.variables) {
        context.variables = {}
      }
      const propagation = ((context.variables as any).__zebric ??= {})
      propagation.currentWorkflow = workflow.name
      if (options?.runner && !propagation.workflowPath?.includes(workflow.name))
        propagation.workflowPath = [...(propagation.workflowPath ?? []), workflow.name]

      const scope = { runner: options?.runner, signal: options?.signal, workflow, path: 'steps', atomic: false, log }
      await this.executionScope.run(scope, async () => {
        const executeSteps = async () => { await this.runSteps(workflow.steps, context, 'steps') }
        if (workflow.transactional) {
          if (typeof this.dataLayer.transaction !== 'function') throw new Error(`Transactional workflow ${workflow.name} requires transaction support`)
          const original = encodeRuntimeValue(context)
          const executeTransaction = async (signal?: AbortSignal) => {
            const attempt = options?.runner ? decodeRuntimeValue<WorkflowContext>(original) : context
            const deferredEvents: Array<Parameters<NonNullable<WorkflowExecutorOptions['onEntityEvent']>>[0]> = []
            await this.executionScope.run({ ...scope, signal, atomic: true }, () =>
              this.deferredEntityEvents.run(deferredEvents, () => this.dataLayer.transaction(async () => {
                await this.runSteps(workflow.steps, attempt, 'steps')
                signal?.throwIfAborted()
                if (options?.runner && this.enqueueEntityEvent) {
                  for (const [index, event] of deferredEvents.entries())
                    await this.enqueueEntityEvent(event, this.eventId(options.runner.identity, `transaction.${index}`))
                }
                await options?.beforeTransactionalCommit?.()
              }))
            )
            if (!options?.runner) for (const event of deferredEvents) await this.onEntityEvent?.(event)
            return attempt.variables
          }
          context.variables = options?.runner
            ? await options.runner.run('transaction', executeTransaction, { atomic: true,
                receipt: options.runner.receipt?.('transaction', original + encodeRuntimeValue(workflow)) })
            : await executeTransaction(options?.signal)
        } else await executeSteps()
      })

      log('info', `Workflow completed: ${workflow.name}`)
      this.executionObserver?.endSpan(workflowSpan)

      return {
        success: true,
        result: context.variables,
        logs,
      }
    } catch (error) {
      if (error instanceof WorkflowSuspended || error instanceof WorkflowLeaseLostError) {
        this.executionObserver?.endSpan(workflowSpan, error instanceof WorkflowSuspended ? undefined : error)
        throw error
      }
      this.executionObserver?.endSpan(workflowSpan, error)
      const failure = error instanceof DomainError
        ? error
        : new WorkflowFailureError(
            error instanceof Error ? error.message : String(error),
            { workflow: workflow.name },
            { cause: error },
          )
      log('error', `Workflow failed: ${failure.message}`, failure)

      return {
        success: false,
        error: failure.message,
        errorCode: failure.code,
        logs,
      }
    }
  }

  private eventId(identity: string, path: string): string {
    return createHash('sha256').update(JSON.stringify([identity, path])).digest('hex')
  }

  private async runSteps(steps: WorkflowStep[], context: WorkflowContext, path: string): Promise<any[]> {
    const results: any[] = []
    const scope = this.executionScope.getStore()!
    for (const [index, step] of steps.entries()) {
      const key = `${path}.${index}`
      scope.signal?.throwIfAborted()
      const result = await this.executionScope.run({ ...scope, path: key }, async () => {
        scope.log('debug', `Executing step ${index + 1}/${steps.length}: ${step.type}`)
        const span = this.executionObserver?.startSpan('zebric.workflow.step', {
          'zebric.workflow.name': scope.workflow.name, 'zebric.workflow.step.type': step.type, 'zebric.workflow.step.index': index,
        }, context.trace?.correlationId ?? context.trace?.executionId)
        try {
          const control = step.type === 'condition' || step.type === 'loop'
          let value: any
          if (scope.runner && !scope.atomic && !control) {
            if (step.type === 'delay') {
              if (step.duration === undefined) throw new Error('Delay step requires duration')
              await scope.runner.delay(key, Number(this.resolveVariables(step.duration, context)))
            } else {
              const receipt = step.type === 'command' ? scope.runner.receipt?.(key, encodeRuntimeValue([
                step.command, this.resolveTypedVariables(step.recordId, context), this.resolveTypedVariables(step.input ?? {}, context)
              ])) : undefined
              value = await scope.runner.run(key, signal => this.executionScope.run({ ...scope, signal, path: key }, () => this.executeStep(step, context)), {
                atomic: step.type === 'query' || step.type === 'command', receipt,
              })
            }
          } else value = await this.executeStep(step, context)
          scope.signal?.throwIfAborted()
          this.executionObserver?.endSpan(span)
          return value
        } catch (error) { this.executionObserver?.endSpan(span, error); throw error }
      })
      if (step.assignTo && result !== undefined) context.variables[step.assignTo] = result
      results.push(result)
    }
    return results
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    switch (step.type) {
      case 'query':
        return this.executeQuery(step, context)

      case 'command':
        return this.executeCommand(step, context)

      case 'service':
        return this.executeService(step, context)

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

  private async executeCommand(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    if (!this.commandExecutor) throw new Error('Command executor is not configured')
    if (!step.command) throw new Error('Command step requires command')
    if (!step.recordId) throw new Error('Command step requires recordId')
    const recordId = String(this.resolveVariables(step.recordId, context))
    const input = step.input ? this.resolveTypedVariables(step.input, context) : {}
    const definition = this.commandExecutor.registry.get(step.command)
    const before = definition
      ? await this.dataLayer.findById(definition.entity, recordId, { session: context.session }).catch(() => null)
      : null
    const result = await this.commandExecutor.execute({
      command: step.command,
      recordId,
      input,
      context: {
        session: context.session,
        source: 'workflow',
        workflow: String((context.variables as any)?.__zebric?.currentWorkflow ?? 'unknown'),
        workflowContext: context.variables,
        correlationId: context.trace?.correlationId ?? context.trace?.executionId,
      },
    })
    if (definition) {
      await this.emitEntityEvent(definition.entity, 'update', before, result.record, context)
    }
    return result.record
  }

  private async executeService(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    if (!this.services) throw new ServiceFailureError('Service registry is not configured')
    if (!step.service) throw new ServiceFailureError('Service step requires service')
    if (!step.operation) throw new ServiceFailureError('Service step requires operation')
    const params = step.params ? this.resolveTypedVariables(step.params, context) : {}
    return this.services.invoke(step.service, step.operation, params, {
      actor: context.session?.actor,
      correlationId: context.trace?.correlationId ?? context.trace?.executionId,
      workflow: String((context.variables as any)?.__zebric?.currentWorkflow ?? 'unknown'),
      workflowContext: context.variables,
    })
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
    const data = step.data ? this.resolveTypedVariables(step.data, context) : undefined
    const where = step.where ? this.resolveTypedVariables(step.where, context) : undefined
    const queryContext = this.executionScope.getStore()?.runner
      ? { session: context.session, source: 'workflow' as const, workflow: this.executionScope.getStore()!.workflow.name }
      : context.session ? { session: context.session } : undefined

    switch (step.action) {
      case 'create':
        if (!data) {
          throw new Error('Create action requires data')
        }
        {
          const created = queryContext
            ? await this.dataLayer.create(step.entity, data, queryContext)
            : await this.dataLayer.create(step.entity, data)
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
          const before = queryContext
            ? await this.dataLayer.findById(step.entity, targetId, queryContext)
            : await this.dataLayer.findById(step.entity, targetId)
          const updateWhere = this.dataLayer.updateWhere?.bind(this.dataLayer)
          const updated = updateWhere
            ? (queryContext
                ? await updateWhere(step.entity, targetId, this.withoutId(where), data, queryContext)
                : await updateWhere(step.entity, targetId, this.withoutId(where), data))
            : (queryContext
                ? await this.dataLayer.update(step.entity, targetId, data, queryContext)
                : await this.dataLayer.update(step.entity, targetId, data))
          await this.emitEntityEvent(step.entity, 'update', before, updated, context)
          return updated
        }

      case 'delete':
        {
          const targetId = this.extractIdFromWhere(where)
          if (!targetId) {
            throw new Error('Delete action requires an id in the where clause')
          }
          const before = queryContext
            ? await this.dataLayer.findById(step.entity, targetId, queryContext)
            : await this.dataLayer.findById(step.entity, targetId)
          if (queryContext) {
            await this.dataLayer.delete(step.entity, targetId, queryContext)
          } else {
            await this.dataLayer.delete(step.entity, targetId)
          }
          await this.emitEntityEvent(step.entity, 'delete', before || { id: targetId }, undefined, context)
          return { deleted: true }
        }

      case 'find': {
        const query = {
          entity: step.entity,
          where,
        }
        return queryContext
          ? this.dataLayer.execute(query, queryContext)
          : this.dataLayer.execute(query)
      }

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
    const params = step.params ? this.resolveTypedVariables(step.params, context) : undefined
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

    const params = step.params ? this.resolveTypedVariables(step.params, context) : {}

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

    const scope = this.executionScope.getStore()!
    const choose = async () => this.evaluateCondition(step.if!, context)
    const condition = scope.runner && !scope.atomic ? await scope.runner.run(`${scope.path}.condition`, choose) : await choose()
    return this.runSteps(condition ? (step.then ?? []) : (step.else ?? []), context, `${scope.path}.${condition ? 'then' : 'else'}`)
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

    // A loop source is a context path rather than an interpolated string. Resolve
    // the whole value without stringifying arrays or objects first.
    const templateMatch = step.items.match(/^\s*\{\{([^}]+)\}\}\s*$/)
    const itemPath = templateMatch?.[1]?.trim() ?? step.items.trim()
    const pathValue = this.getValueByPath(context, itemPath)
    const scope = this.executionScope.getStore()!
    const resolveItems = async () => pathValue !== undefined ? pathValue : this.resolveVariables(step.items, context)
    const items = scope.runner && !scope.atomic ? await scope.runner.run(`${scope.path}.items`, resolveItems) : await resolveItems()

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
      results.push(...await this.runSteps(step.do, loopContext, `${scope.path}.loop.${i}`))
    }

    return results
  }

  /**
   * Execute a delay step
   */
  private async executeDelay(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    if (step.duration === undefined) {
      throw new Error('Delay step requires duration')
    }

    const duration = typeof step.duration === 'number'
      ? step.duration
      : parseInt(this.resolveVariables(step.duration, context), 10)

    if (isNaN(duration) || duration < 0) {
      throw new Error(`Invalid delay duration: ${step.duration}`)
    }

    const signal = this.executionScope.getStore()?.signal
    if (signal) await wait(duration, signal)
    else await new Promise(resolve => setTimeout(resolve, duration))
  }

  /**
   * Resolve variables in a value using context
   */
  private resolveVariables(value: any, context: WorkflowContext): any {
    if (typeof value === 'string') {
      // Replace {{variable}} patterns
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
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveVariables(val, context)
      }
      return resolved
    }

    return value
  }

  /** Preserve arrays/objects when a value is a complete template expression. */
  private resolveTypedVariables(value: any, context: WorkflowContext): any {
    if (typeof value === 'string') {
      const exact = value.match(/^\s*\{\{([^}]+)\}\}\s*$/)
      if (exact?.[1]) {
        const resolved = this.resolveTemplateValue(context, exact[1].trim())
        if (resolved !== undefined) return resolved
      }
      return this.resolveVariables(value, context)
    }
    if (Array.isArray(value)) return value.map(item => this.resolveTypedVariables(item, context))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        this.resolveTypedVariables(item, context),
      ]))
    }
    return value
  }

  private resolveTemplateValue(context: WorkflowContext, path: string): any {
    const resolved = this.getValueByPath(context, path)
    if (resolved !== undefined) {
      return resolved
    }

    const suffixes = ['.value', '.label', '.id']
    for (const suffix of suffixes) {
      if (!path.endsWith(suffix)) {
        continue
      }

      const basePath = path.slice(0, -suffix.length)
      const baseValue = this.getValueByPath(context, basePath)
      if (baseValue === undefined) {
        continue
      }

      if (baseValue && typeof baseValue === 'object') {
        const key = suffix.slice(1)
        const direct = (baseValue as any)[key]
        if (direct !== undefined && direct !== null) {
          return direct
        }
      }

      return baseValue
    }

    return undefined
  }

  private coerceTemplateValue(value: any): any {
    let current = value
    for (let depth = 0; depth < 5; depth++) {
      if (!current || typeof current !== 'object') {
        return current
      }

      if ('value' in current && current.value !== undefined && current.value !== null) {
        current = current.value
        continue
      }

      if ('id' in current && current.id !== undefined && current.id !== null) {
        current = current.id
        continue
      }

      if ('label' in current && current.label !== undefined && current.label !== null) {
        current = current.label
        continue
      }

      return JSON.stringify(current)
    }

    return typeof current === 'object' ? JSON.stringify(current) : current
  }

  private formatTemplateValue(value: any): string {
    const primitive = this.extractPrimitiveValue(value)
    if (primitive === undefined || primitive === null) {
      return ''
    }
    return String(primitive)
  }

  private extractPrimitiveValue(value: any, depth = 0): any {
    if (depth > 8) {
      return undefined
    }
    if (value === null || value === undefined) {
      return value
    }
    const type = typeof value
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
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
    if (type === 'object') {
      const preferredKeys = ['value', 'label', 'text', 'name', 'title', 'id']
      for (const key of preferredKeys) {
        if (key in value) {
          const extracted = this.extractPrimitiveValue((value as any)[key], depth + 1)
          if (extracted !== undefined && extracted !== null) {
            return extracted
          }
        }
      }

      for (const entry of Object.values(value)) {
        const extracted = this.extractPrimitiveValue(entry, depth + 1)
        if (extracted !== undefined && extracted !== null) {
          return extracted
        }
      }

      try {
        return JSON.stringify(value)
      } catch {
        return undefined
      }
    }

    return String(value)
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

  private withoutId(where: any): Record<string, any> {
    if (!where || typeof where !== 'object') return {}
    const { id: _id, ...expected } = where
    return expected
  }

  private async emitEntityEvent(
    entity: string,
    event: 'create' | 'update' | 'delete',
    before: any,
    after: any,
    context: WorkflowContext
  ): Promise<void> {
    if (!this.onEntityEvent && !this.enqueueEntityEvent) {
      return
    }

    const depth = Number((context.variables as any)?.__zebric?.depth || 0)
    const sourceWorkflow = String((context.variables as any)?.__zebric?.currentWorkflow || 'unknown')
    const workflowPath = Array.isArray((context.variables as any)?.__zebric?.workflowPath)
      ? [...(context.variables as any).__zebric.workflowPath]
      : []

    const entityEvent = {
      entity,
      event,
      before,
      after,
      sourceWorkflow,
      depth,
      workflowPath,
      trace: context.trace,
      session: context.session,
      attribution: context.variables?.data?.attribution,
    }
    const deferred = this.deferredEntityEvents.getStore()
    if (deferred) {
      deferred.push(entityEvent)
      return
    }
    const scope = this.executionScope.getStore()
    scope?.signal?.throwIfAborted()
    if (scope?.runner && this.enqueueEntityEvent) {
      await this.enqueueEntityEvent(entityEvent, this.eventId(scope.runner.identity, scope.path))
    } else await this.onEntityEvent?.(entityEvent)
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
    return evaluateWorkflowCondition(condition, context)
  }
}
