import type { Actor } from '../auth/actor.js'
import { actorFromSession, sessionWithActor } from '../auth/actor.js'
import { SYSTEM_SESSION } from '../auth/provider.js'
import type { Blueprint, Command, CommandInputField } from '../types/blueprint.js'
import type { QueryExecutorPort, RequestContext, RuntimePorts } from '../routing/request-ports.js'
import {
  AuthorizationFailureError,
  CommandUnavailableError,
  ValidationFailureError,
} from '../errors/domain-errors.js'
import { CommandRegistry } from './registry.js'
import { issueCommandMutationAuthority } from './protection.js'
import { PolicyEvaluator } from '../policy/evaluator.js'
import type { ServiceInvoker } from '../services/registry.js'

export interface CommandExecutionRequest {
  command: string
  recordId: string
  input?: Record<string, unknown>
  actor?: Actor
  context?: RequestContext
}

export interface CommandExecutionResult {
  command: string
  record: Record<string, unknown>
}

export interface CommandHandlerContext {
  actor: Actor
  input: Record<string, unknown>
  record: Record<string, unknown>
  command: Command
  services?: ServiceInvoker
  correlationId?: string
  workflow?: string
}

export type CommandHandler = (
  context: CommandHandlerContext,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void

export class CommandExecutor {
  readonly registry: CommandRegistry
  private readonly handlers = new Map<string, CommandHandler>()
  private readonly policyEvaluator: PolicyEvaluator

  constructor(
    private readonly blueprint: Blueprint,
    private readonly ports: RuntimePorts & { queryExecutor: QueryExecutorPort },
  ) {
    this.registry = new CommandRegistry(blueprint.commands)
    this.policyEvaluator = new PolicyEvaluator(blueprint, ports.queryExecutor)
  }

  registerHandler(reference: string, handler: CommandHandler): void {
    this.handlers.set(reference, handler)
  }

  /**
   * Evaluate whether a command may be offered for an already-loaded record.
   * Execution repeats these checks and remains authoritative.
   */
  async isAvailable(
    commandName: string,
    record: Record<string, unknown>,
    context: RequestContext = {},
  ): Promise<boolean> {
    const command = this.registry.get(commandName)
    if (!command) return false
    if (command.handler && !this.handlers.has(command.handler)) return false
    const actor = context.actor ?? actorFromSession(context.session)
    if (!actor) return false
    const effectiveSession = sessionWithActor(context.session, actor)
    const policyContext = {
      actor,
      session: effectiveSession,
      record,
      input: {},
      workflow: context.workflowContext,
      entity: command.entity,
    }
    if (!await this.policyEvaluator.evaluate(command.policy, policyContext)) return false
    return this.policyEvaluator.evaluate(command.availableWhen, policyContext)
  }

  async execute(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    const span = this.ports.executionObserver?.startSpan('zebric.command', {
      'zebric.command.name': request.command,
      'zebric.source': request.context?.source,
    }, request.context?.correlationId)
    try {
      const result = await this.executeCommand(request)
      this.ports.executionObserver?.endSpan(span)
      return result
    } catch (error) {
      this.ports.executionObserver?.endSpan(span, error)
      throw error
    }
  }

  private async executeCommand(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
    const command = this.registry.get(request.command)
    if (!command) throw new CommandUnavailableError(`Unknown command: ${request.command}`)

    const session = request.context?.session
    const actor = request.actor ?? request.context?.actor ?? actorFromSession(session)
    if (!actor) {
      throw new AuthorizationFailureError(`Command ${command.name} requires an authenticated actor`)
    }
    const effectiveSession = sessionWithActor(session, actor)
    const input = request.input ?? {}
    validateInput(command, input)

    // Fetching with the internal session avoids coupling command availability to generic
    // read permission. The command policy and the subsequent mutation remain authoritative.
    const record = await this.ports.queryExecutor.findById(
      command.entity,
      request.recordId,
      { session: SYSTEM_SESSION },
    ) as Record<string, unknown> | null
    if (!record) {
      throw new CommandUnavailableError(`${command.entity} ${request.recordId} was not found`, {
        command: command.name,
        entity: command.entity,
        recordId: request.recordId,
      })
    }
    const policySpan = this.ports.executionObserver?.startSpan('zebric.policy', {
      'zebric.command.name': command.name,
      'zebric.entity': command.entity,
    }, request.context?.correlationId)
    let policyAllowed: boolean
    try {
      policyAllowed = await this.policyEvaluator.evaluate(command.policy, {
        actor,
        session: effectiveSession,
        record,
        input,
        workflow: request.context?.workflowContext,
        entity: command.entity,
      })
      this.ports.executionObserver?.endSpan(policySpan)
    } catch (error) {
      this.ports.executionObserver?.endSpan(policySpan, error)
      throw error
    }
    if (!policyAllowed) {
      throw new AuthorizationFailureError(`Actor ${actor.id} may not execute ${command.name}`, {
        command: command.name,
        actorId: actor.id,
        recordId: request.recordId,
      })
    }
    const available = await this.policyEvaluator.evaluate(command.availableWhen, {
      actor,
      session: effectiveSession,
      record,
      input,
      workflow: request.context?.workflowContext,
      entity: command.entity,
    })
    if (!available) {
      throw new CommandUnavailableError(`${command.name} is not available for this record`, {
        command: command.name,
        entity: command.entity,
        recordId: request.recordId,
      })
    }

    let committedMutations: Record<string, unknown> = {}
    const operation = async () => {
      const mutations = resolveMutations(command.mutations ?? {}, actor, record, input)
      if (command.handler) {
        const handler = this.handlers.get(command.handler)
        if (!handler) {
          throw new CommandUnavailableError(`Handler ${command.handler} is not registered`, {
            command: command.name,
          })
        }
        const services: ServiceInvoker | undefined = this.ports.services && {
          invoke: (service, operation, params, context) => this.ports.services!.invoke(
            service,
            operation,
            params,
            {
              actor,
              correlationId: request.context?.correlationId,
              workflow: request.context?.workflow,
              workflowContext: request.context?.workflowContext,
              ...context,
            },
          ),
        }
        Object.assign(mutations, await handler({
          actor,
          input,
          record,
          command,
          services,
          correlationId: request.context?.correlationId,
          workflow: request.context?.workflow,
        }) ?? {})
      }
      committedMutations = { ...mutations }
      return this.ports.queryExecutor.update(command.entity, request.recordId, mutations, {
        ...request.context,
        session: effectiveSession,
        actor,
        commandMutation: issueCommandMutationAuthority(command.name, command.entity),
      }) as Promise<Record<string, unknown>>
    }

    const updated = this.ports.queryExecutor.transaction
      ? await this.ports.queryExecutor.transaction(operation)
      : await operation()

    const occurredAt = new Date().toISOString()
    this.ports.auditLogger?.log({
      eventType: 'domain.command',
      severity: 'info',
      action: command.name,
      resource: `${command.entity}:${request.recordId}`,
      success: true,
      userId: actor.delegatedBy ?? actor.id,
      entityType: command.entity,
      entityId: request.recordId,
      metadata: {
        actor: { id: actor.id, type: actor.type },
        delegatedBy: actor.delegatedBy,
        command: command.name,
        workflow: request.context?.workflow,
        source: request.context?.source,
        correlationId: request.context?.correlationId,
        mutation: committedMutations,
      },
      correlationId: request.context?.correlationId,
      actorType: actor.type,
      actorId: actor.id,
      workflowName: request.context?.workflow,
      actionName: command.name,
    })
    await this.ports.eventPublisher?.publish({
      name: command.name,
      entity: command.entity,
      recordId: request.recordId,
      command: command.name,
      actor,
      data: updated,
      occurredAt,
      correlationId: request.context?.correlationId,
    })

    return { command: command.name, record: updated }
  }
}

function validateInput(command: Command, input: Record<string, unknown>): void {
  const schema = command.input ?? {}
  const unknown = Object.keys(input).filter(key => !(key in schema))
  if (unknown.length > 0) {
    throw new ValidationFailureError(`Unknown input for ${command.name}: ${unknown.join(', ')}`)
  }
  for (const [name, field] of Object.entries(schema)) {
    const value = input[name]
    if ((value === undefined || value === null) && field.required) {
      throw new ValidationFailureError(`Missing required command input: ${name}`, { command: command.name, field: name })
    }
    if (value != null && !matchesInputType(value, field)) {
      throw new ValidationFailureError(`Invalid value for command input: ${name}`, { command: command.name, field: name })
    }
  }
}

function matchesInputType(value: unknown, field: CommandInputField): boolean {
  if (field.type === 'Integer') return typeof value === 'number' && Number.isInteger(value)
  if (field.type === 'Float') return typeof value === 'number' && Number.isFinite(value)
  if (field.type === 'Boolean') return typeof value === 'boolean'
  if (field.type === 'JSON') return typeof value === 'object'
  if (field.type === 'Enum') return typeof value === 'string' && (field.values?.includes(value) ?? true)
  return typeof value === 'string'
}

function resolveMutations(
  mutations: Record<string, unknown>,
  actor: Actor,
  record: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = Object.entries(mutations)
    .map(([field, value]) => [field, resolveValue(value, actor, record, input)] as const)
    .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
  return Object.fromEntries(resolved)
}

function resolvePath(
  path: string,
  actor: Actor,
  record: Record<string, unknown>,
  input: Record<string, unknown>,
): unknown {
  if (path === 'actor.effectiveId') return actor.delegatedBy ?? actor.id
  if (path.startsWith('actor.')) return getPath(actor as unknown as Record<string, unknown>, path.slice(6))
  if (path.startsWith('record.')) return getPath(record, path.slice(7))
  if (path.startsWith('input.')) return getPath(input, path.slice(6))
  return getPath(record, path)
}

function resolveValue(
  value: unknown,
  actor: Actor,
  record: Record<string, unknown>,
  input: Record<string, unknown>,
): unknown {
  if (value === 'now') return new Date()
  if (typeof value !== 'string') return value
  if (value === 'actor.id') return actor.id
  if (value === 'actor.effectiveId') return actor.delegatedBy ?? actor.id
  if (value.startsWith('actor.') || value.startsWith('record.') || value.startsWith('input.')) {
    return resolvePath(value, actor, record, input)
  }
  return value
}

function getPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current == null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}
