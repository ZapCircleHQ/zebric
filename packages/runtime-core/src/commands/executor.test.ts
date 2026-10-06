import { describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../types/blueprint.js'
import type { QueryExecutorPort, RequestContext } from '../routing/request-ports.js'
import { CommandExecutor } from './executor.js'
import { assertProtectedMutation } from './protection.js'
import { CommandUnavailableError, ProtectedFieldMutationError, ValidationFailureError } from '../errors/domain-errors.js'

const blueprint: Blueprint = {
  version: '1',
  project: { name: 'Commands', version: '0.6.0', runtime: { min_version: '0.6.0' } },
  pages: [],
  entities: [{
    name: 'Request',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'status', type: 'Enum', values: ['pending', 'approved'], write: 'command-only', commands: ['ApproveRequest'] },
      { name: 'requestedFromId', type: 'Text' },
      { name: 'approvedById', type: 'Text', write: 'command-only', commands: ['ApproveRequest'] },
      { name: 'comment', type: 'Text' },
    ],
  }],
  commands: [{
    name: 'ApproveRequest',
    entity: 'Request',
    input: { comment: { type: 'Text', required: false } },
    policy: 'record.requestedFromId == actor.effectiveId && record.status == "pending"',
    mutations: {
      status: 'approved',
      approvedById: 'actor.id',
      comment: 'input.comment',
    },
  }],
}

class MemoryQueryExecutor implements QueryExecutorPort {
  record: Record<string, unknown> = {
    id: 'req-1',
    status: 'pending',
    requestedFromId: 'sarah',
  }

  async execute(): Promise<unknown[]> { return [this.record] }
  async create(): Promise<unknown> { throw new Error('not implemented') }
  async delete(): Promise<void> { throw new Error('not implemented') }
  async search(): Promise<unknown[]> { return [] }
  async findById(): Promise<unknown> { return { ...this.record } }
  async transaction<T>(fn: () => Promise<T>): Promise<T> { return fn() }

  async update(_entity: string, _id: string, data: Record<string, unknown>, context: RequestContext): Promise<unknown> {
    assertProtectedMutation(blueprint.entities[0], data, context)
    this.record = { ...this.record, ...data }
    return { ...this.record }
  }
}

describe('CommandExecutor', () => {
  it('stages audit and domain events inside the mutation transaction instead of publishing after commit', async () => {
    let active = false
    class TransactionExecutor extends MemoryQueryExecutor {
      override async transaction<T>(operation: () => Promise<T>): Promise<T> {
        active = true
        try { return await operation() } finally { active = false }
      }
    }
    const queryExecutor = new TransactionExecutor()
    const enqueue = vi.fn(async effects => {
      expect(active).toBe(true)
      expect(queryExecutor.record.status).toBe('approved')
      expect(effects.audit[0]).toMatchObject({ eventType: 'domain.command', actionName: 'ApproveRequest' })
      expect(effects.events[0]).toMatchObject({ name: 'ApproveRequest', data: { status: 'approved' } })
    })
    const log = vi.fn()
    const publish = vi.fn()
    const executor = new CommandExecutor(blueprint, {
      queryExecutor, commandEffects: { enqueue }, auditLogger: { log }, eventPublisher: { publish },
    })
    await executor.execute({ command: 'ApproveRequest', recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: [], scopes: [] } })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('aborts the command when transactional effects cannot be staged', async () => {
    class RollbackExecutor extends MemoryQueryExecutor {
      override async transaction<T>(operation: () => Promise<T>): Promise<T> {
        const original = { ...this.record }
        try { return await operation() } catch (error) { this.record = original; throw error }
      }
    }
    const queryExecutor = new RollbackExecutor()
    const executor = new CommandExecutor(blueprint, {
      queryExecutor, commandEffects: { enqueue: async () => { throw new Error('journal failed') } },
    })
    await expect(executor.execute({ command: 'ApproveRequest', recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: [], scopes: [] } })).rejects.toThrow('journal failed')
    expect(queryExecutor.record.status).toBe('pending')
  })

  it('requires transaction support before enabling transactional effects', () => {
    const queryExecutor = new MemoryQueryExecutor()
    Object.defineProperty(queryExecutor, 'transaction', { value: undefined })
    expect(() => new CommandExecutor(blueprint, { queryExecutor,
      commandEffects: { enqueue: async () => {} } })).toThrow('Transactional command effects require transactions')
    expect(queryExecutor.record.status).toBe('pending')
  })
  it('uses command policy and availability metadata to decide whether UI may offer it', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    const availabilityBlueprint: Blueprint = {
      ...blueprint,
      commands: [{ ...blueprint.commands![0]!, availableWhen: 'record.status == "pending"' }],
    }
    const executor = new CommandExecutor(availabilityBlueprint, { queryExecutor })
    const context = {
      session: {
        id: 'session-1', userId: 'sarah',
        user: { id: 'sarah', email: 'sarah@example.test' },
        createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      },
      source: 'ui' as const,
    }

    await expect(executor.isAvailable('ApproveRequest', queryExecutor.record, context)).resolves.toBe(true)
    await expect(executor.isAvailable(
      'ApproveRequest', { ...queryExecutor.record, status: 'approved' }, context,
    )).resolves.toBe(false)
    await expect(executor.isAvailable('MissingCommand', queryExecutor.record, context)).resolves.toBe(false)
  })

  it('defers input-dependent policy and availability checks until submission', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    const inputBlueprint: Blueprint = {
      ...blueprint,
      commands: [{
        ...blueprint.commands![0]!,
        input: { stage: { type: 'Text', required: true } },
        policy: 'actor.id == "sarah" && input.stage == "approved"',
        availableWhen: 'input.stage != record.status',
        mutations: { status: 'input.stage' },
      }],
    }
    const executor = new CommandExecutor(inputBlueprint, { queryExecutor })
    const actor = { id: 'sarah', type: 'user' as const, roles: [], scopes: [] }

    await expect(executor.isAvailable('ApproveRequest', queryExecutor.record, { actor })).resolves.toBe(true)
    await expect(executor.isAvailable('ApproveRequest', queryExecutor.record, {
      actor: { id: 'someone-else', type: 'user', roles: [], scopes: [] },
    })).resolves.toBe(false)
    await expect(executor.execute({
      command: 'ApproveRequest', recordId: 'req-1', actor, input: { stage: 'pending' },
    })).rejects.toThrow('may not execute')
    await expect(executor.execute({
      command: 'ApproveRequest', recordId: 'req-1', actor, input: { stage: 'approved' },
    })).resolves.toMatchObject({ record: { status: 'approved' } })
  })

  it('executes an authorized command through the protected mutation boundary', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    const publish = vi.fn()
    const log = vi.fn()
    const startSpan = vi.fn((name: string) => name)
    const endSpan = vi.fn()
    const executor = new CommandExecutor(blueprint, {
      queryExecutor,
      eventPublisher: { publish },
      auditLogger: { log },
      executionObserver: { startSpan, endSpan },
    })

    const result = await executor.execute({
      command: 'ApproveRequest',
      recordId: 'req-1',
      input: { comment: 'Looks good' },
      actor: {
        id: 'sales-agent',
        type: 'agent',
        roles: ['approver'],
        scopes: ['requests:approve'],
        delegatedBy: 'sarah',
      },
      context: { source: 'mcp', correlationId: 'trace-1' },
    })

    expect(result.record).toMatchObject({
      status: 'approved',
      approvedById: 'sales-agent',
      comment: 'Looks good',
    })
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ApproveRequest',
      userId: 'sarah',
      metadata: expect.objectContaining({ delegatedBy: 'sarah', source: 'mcp' }),
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ApproveRequest',
      correlationId: 'trace-1',
    }))
    expect(startSpan.mock.calls.map(call => call[0])).toEqual(['zebric.command', 'zebric.policy'])
    expect(endSpan).toHaveBeenCalledTimes(2)
  })

  it('does not let an actor with command permission bypass the command', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    await expect(queryExecutor.update('Request', 'req-1', { status: 'approved' }, {
      actor: { id: 'sarah', type: 'user', roles: ['approver'], scopes: [] },
    })).rejects.toBeInstanceOf(ProtectedFieldMutationError)
    expect(queryExecutor.record.status).toBe('pending')
  })

  it('enforces record availability again during execution', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    queryExecutor.record.status = 'approved'
    const executor = new CommandExecutor({
      ...blueprint,
      commands: [{ ...blueprint.commands![0]!, policy: true, availableWhen: 'record.status == "pending"' }],
    }, { queryExecutor })

    await expect(executor.execute({
      command: 'ApproveRequest', recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: ['approver'], scopes: [] },
    })).rejects.toBeInstanceOf(CommandUnavailableError)
    expect(queryExecutor.record.status).toBe('approved')
  })

  it('validates command input before mutation', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    const executor = new CommandExecutor(blueprint, { queryExecutor })
    await expect(executor.execute({
      command: 'ApproveRequest',
      recordId: 'req-1',
      input: { unexpected: true },
      actor: { id: 'sarah', type: 'user', roles: ['approver'], scopes: [] },
    })).rejects.toBeInstanceOf(ValidationFailureError)
    expect(queryExecutor.record.status).toBe('pending')
  })

  it('does not publish audit or events when the transaction rolls back', async () => {
    class RollbackExecutor extends MemoryQueryExecutor {
      override async transaction<T>(fn: () => Promise<T>): Promise<T> {
        const snapshot = { ...this.record }
        await fn()
        this.record = snapshot
        throw new Error('commit failed')
      }
    }
    const queryExecutor = new RollbackExecutor()
    const publish = vi.fn()
    const log = vi.fn()
    const executor = new CommandExecutor(blueprint, {
      queryExecutor, eventPublisher: { publish }, auditLogger: { log },
    })
    await expect(executor.execute({
      command: 'ApproveRequest', recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: ['approver'], scopes: [] },
    })).rejects.toThrow('commit failed')
    expect(queryExecutor.record.status).toBe('pending')
    expect(log).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('injects named services into application command handlers', async () => {
    const queryExecutor = new MemoryQueryExecutor()
    const services = { invoke: vi.fn().mockResolvedValue({ score: 92 }) }
    const publish = vi.fn()
    const log = vi.fn()
    const handlerBlueprint: Blueprint = {
      ...blueprint,
      commands: [{
        ...blueprint.commands![0]!,
        mutations: {},
        handler: 'commands.approve',
      }],
    }
    const executor = new CommandExecutor(handlerBlueprint, {
      queryExecutor, services, eventPublisher: { publish }, auditLogger: { log },
    })
    executor.registerHandler('commands.approve', async context => {
      const result = await context.services!.invoke('risk', 'score', { id: context.record.id }) as { score: number }
      await context.db.findById('Request', String(context.record.id))
      context.events.publish({ name: 'RiskScored', data: { score: result.score } })
      context.audit.log({ action: 'risk.scored', metadata: { score: result.score } })
      return { comment: `Risk score: ${result.score}` }
    })

    const result = await executor.execute({
      command: 'ApproveRequest',
      recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: ['approver'], scopes: [] },
      context: { correlationId: 'trace-handler' },
    })

    expect(result.record.comment).toBe('Risk score: 92')
    expect(services.invoke).toHaveBeenCalledWith('risk', 'score', { id: 'req-1' }, expect.objectContaining({
      correlationId: 'trace-handler',
    }))
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'risk.scored' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      name: 'RiskScored', command: 'ApproveRequest', recordId: 'req-1',
    }))
  })

  it('discards handler audit entries and events when the transaction rolls back', async () => {
    class RollbackExecutor extends MemoryQueryExecutor {
      override async transaction<T>(fn: () => Promise<T>): Promise<T> {
        await fn()
        throw new Error('commit failed')
      }
    }
    const publish = vi.fn()
    const log = vi.fn()
    const handlerBlueprint: Blueprint = {
      ...blueprint,
      commands: [{ ...blueprint.commands![0]!, mutations: {}, handler: 'commands.approve' }],
    }
    const executor = new CommandExecutor(handlerBlueprint, {
      queryExecutor: new RollbackExecutor(), eventPublisher: { publish }, auditLogger: { log },
    })
    executor.registerHandler('commands.approve', context => {
      context.events.publish({ name: 'ShouldNotPublish' })
      context.audit.log({ action: 'should.not.log' })
      return { status: 'approved' }
    })

    await expect(executor.execute({
      command: 'ApproveRequest', recordId: 'req-1',
      actor: { id: 'sarah', type: 'user', roles: [], scopes: [] },
    })).rejects.toThrow('commit failed')
    expect(publish).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('defers command side effects to an enclosing transaction commit', async () => {
    class NestedTransactionExecutor extends MemoryQueryExecutor {
      private active = false
      private effects: Array<() => Promise<void> | void> = []
      override async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (this.active) return fn()
        this.active = true
        try {
          const result = await fn()
          for (const effect of this.effects) await effect()
          return result
        } finally {
          this.effects = []
          this.active = false
        }
      }
      async afterCommit(effect: () => Promise<void> | void): Promise<void> {
        if (this.active) this.effects.push(effect)
        else await effect()
      }
    }
    const queryExecutor = new NestedTransactionExecutor()
    const publish = vi.fn()
    const log = vi.fn()
    const executor = new CommandExecutor(blueprint, {
      queryExecutor, eventPublisher: { publish }, auditLogger: { log },
    })

    await expect(queryExecutor.transaction(async () => {
      await executor.execute({
        command: 'ApproveRequest', recordId: 'req-1',
        actor: { id: 'sarah', type: 'user', roles: [], scopes: [] },
      })
      expect(log).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      throw new Error('later workflow step failed')
    })).rejects.toThrow('later workflow step failed')
    expect(log).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
