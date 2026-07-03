import { describe, it, expect, vi } from 'vitest'
import { handleSkillEntityAction, handleSkillWorkflow } from './server-action-handlers.js'
import type { Context } from 'hono'
import type { SkillAction } from '@zebric/runtime-core'

const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
const record = { id: 'item-1', title: 'Test item', status: 'open' }

function makeContext(overrides: {
  method?: string
  paramId?: string
  json?: Record<string, any>
  query?: Record<string, string>
} = {}): Context {
  return {
    get: (_key: string) => undefined,
    req: {
      param: (name: string) => (name === 'id' ? (overrides.paramId ?? 'item-1') : undefined),
      query: (name: string) => overrides.query?.[name] ?? '',
      json: async () => overrides.json ?? {},
      header: (_name: string) => undefined,
    },
  } as unknown as Context
}

describe('handleSkillEntityAction — session forwarding to findById', () => {
  describe('get action', () => {
    it('passes session to findById', async () => {
      const findById = vi.fn(async () => record)
      const c = makeContext()

      await handleSkillEntityAction(
        c,
        { action: 'get', entity: 'Item', path: '/items/{id}', method: 'GET' } as SkillAction,
        session,
        { queryExecutor: { findById } as any }
      )

      expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
    })

    it('does not call findById with undefined session', async () => {
      const findById = vi.fn(async () => record)
      const c = makeContext()

      await handleSkillEntityAction(
        c,
        { action: 'get', entity: 'Item', path: '/items/{id}', method: 'GET' } as SkillAction,
        null,
        { queryExecutor: { findById } as any }
      )

      expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session: null })
    })
  })

  describe('update action — before-state snapshot', () => {
    it('passes session to before-state findById when workflowManager is present', async () => {
      const findById = vi.fn(async () => record)
      const update = vi.fn(async () => ({ ...record, title: 'Updated' }))
      const trigger = vi.fn(async () => {})
      const triggerEntityEvent = vi.fn(async () => {})
      const c = makeContext({ json: { title: 'Updated' } })

      await handleSkillEntityAction(
        c,
        { action: 'update', entity: 'Item', path: '/items/{id}', method: 'PATCH' } as SkillAction,
        session,
        {
          queryExecutor: { findById, update } as any,
          workflowManager: { triggerEntityEvent } as any,
        }
      )

      expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
    })
  })

  describe('delete action — before-state snapshot', () => {
    it('passes session to before-state findById when workflowManager is present', async () => {
      const findById = vi.fn(async () => record)
      const del = vi.fn(async () => {})
      const triggerEntityEvent = vi.fn(async () => {})
      const c = makeContext()

      await handleSkillEntityAction(
        c,
        { action: 'delete', entity: 'Item', path: '/items/{id}', method: 'DELETE' } as SkillAction,
        session,
        {
          queryExecutor: { findById, delete: del } as any,
          workflowManager: { triggerEntityEvent } as any,
        }
      )

      expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
    })
  })
})

describe('handleSkillWorkflow — session forwarding to findById', () => {
  it('passes session to findById when loading record context', async () => {
    const findById = vi.fn(async () => record)
    const trigger = vi.fn(() => ({ id: 'job-1' }))
    const getWorkflow = vi.fn(() => ({ name: 'MyWorkflow' }))
    const c = makeContext()

    const action: SkillAction = {
      action: 'workflow',
      workflow: 'MyWorkflow',
      entity: 'Item',
      path: '/items/{id}/run',
      method: 'POST',
    } as SkillAction

    await handleSkillWorkflow(c, action, session, {
      queryExecutor: { findById } as any,
      workflowManager: { getWorkflow, trigger } as any,
    })

    expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
  })
})
