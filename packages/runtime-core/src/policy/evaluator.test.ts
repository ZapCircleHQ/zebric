import { describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../types/blueprint.js'
import type { QueryExecutorPort } from '../routing/request-ports.js'
import { PolicyEvaluator } from './evaluator.js'
import { PermissionManager } from '../auth/permissions.js'
import { filterRecordsByReadPolicy } from '../database/access-control.js'

const blueprint: Blueprint = {
  version: '1',
  project: { name: 'Policy', version: '0.6.0', runtime: { min_version: '0.6.0' } },
  pages: [],
  entities: [
    {
      name: 'Account',
      fields: [
        { name: 'id', type: 'ULID' },
        { name: 'teamId', type: 'Ref', ref: 'Team.id' },
      ],
      relations: { team: { type: 'belongsTo', entity: 'Team', foreign_key: 'teamId' } },
    },
    {
      name: 'Team',
      fields: [{ name: 'id', type: 'ULID' }],
      relations: { members: { type: 'hasMany', entity: 'Membership', foreign_key: 'teamId' } },
    },
    {
      name: 'Membership',
      fields: [
        { name: 'id', type: 'ULID' },
        { name: 'teamId', type: 'Ref', ref: 'Team.id' },
        { name: 'userId', type: 'Text' },
      ],
    },
  ],
}

const queryExecutor: QueryExecutorPort = {
  execute: vi.fn(async query => query.entity === 'Membership'
    ? [{ id: 'membership-1', teamId: 'team-1', userId: 'sarah' }]
    : []),
  findById: vi.fn(async (entity, id) => entity === 'Team' && id === 'team-1' ? { id: 'team-1' } : null),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  search: vi.fn(),
}

describe('PolicyEvaluator', () => {
  it('evaluates record-aware policy expressions', async () => {
    const evaluator = new PolicyEvaluator()
    await expect(evaluator.evaluate(
      'record.ownerId == actor.effectiveId && record.status != "archived"',
      {
        actor: { id: 'agent-1', type: 'agent', roles: [], scopes: [], delegatedBy: 'sarah' },
        record: { ownerId: 'sarah', status: 'active' },
      },
    )).resolves.toBe(true)
  })

  it('traverses only declared relations for membership policies', async () => {
    const evaluator = new PolicyEvaluator(blueprint, queryExecutor)
    const policy = 'record.team.members.userId contains actor.effectiveId'
    const base = { record: { id: 'account-1', teamId: 'team-1' }, entity: 'Account' }

    await expect(evaluator.evaluate(policy, {
      ...base,
      actor: { id: 'agent-1', type: 'agent', roles: [], scopes: [], delegatedBy: 'sarah' },
    })).resolves.toBe(true)
    await expect(evaluator.evaluate(policy, {
      ...base,
      actor: { id: 'agent-1', type: 'agent', roles: [], scopes: [], delegatedBy: 'bob' },
    })).resolves.toBe(false)
    expect(queryExecutor.findById).toHaveBeenCalledWith('Team', 'team-1', expect.objectContaining({
      session: expect.objectContaining({ actor: expect.objectContaining({ type: 'system' }) }),
    }))
  })

  it('preserves actor identity separately from effective delegated identity', async () => {
    const evaluator = new PolicyEvaluator()
    await expect(evaluator.evaluate(
      'actor.id == "agent-1" && actor.effectiveId == "sarah" && actor.delegatedBy == "sarah"',
      { actor: { id: 'agent-1', type: 'agent', roles: [], scopes: [], delegatedBy: 'sarah' } },
    )).resolves.toBe(true)
  })

  it('applies record-aware RBAC conditions to collection results', async () => {
    const entity = {
      name: 'Account',
      fields: [
        { name: 'id', type: 'ULID' as const },
        { name: 'ownerId', type: 'Text' as const },
      ],
    }
    const permissions = new PermissionManager({
      providers: [],
      permissions: {
        agent: {
          allow: [{
            entity: 'Account',
            actions: ['read'],
            condition: 'record.ownerId == actor.effectiveId',
          }],
        },
      },
    })
    const session = {
      id: 'session-1',
      userId: 'sales-agent',
      user: { id: 'sales-agent', email: 'agent@example.test', roles: ['agent'] },
      actor: { type: 'agent' as const, id: 'sales-agent', roles: ['agent'], delegatedBy: 'sarah' },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }

    await expect(permissions.checkPermission({ session, entity: 'Account', action: 'read' }))
      .resolves.toBe(true)
    await expect(filterRecordsByReadPolicy(entity, [
      { id: 'mine', ownerId: 'sarah' },
      { id: 'theirs', ownerId: 'lee' },
    ], session, new PolicyEvaluator(), permissions)).resolves.toEqual([
      { id: 'mine', ownerId: 'sarah' },
    ])
  })
})
