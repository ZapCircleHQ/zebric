import { describe, it, expect, vi } from 'vitest'
import { checkFormAuthorization } from './form-processor.js'
import type { Blueprint } from '../types/blueprint.js'

const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }

const blueprint: Blueprint = {
  version: '1.0',
  project: { name: 'Test', version: '1.0', runtime: { min_version: '0.1.0' } },
  entities: [
    {
      name: 'Task',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'title', type: 'Text', required: true },
      ],
      access: { read: 'authenticated', create: 'authenticated', update: 'authenticated', delete: 'authenticated' },
    },
  ],
  pages: [],
} as any

describe('checkFormAuthorization — session forwarding to findById', () => {
  it('passes session to findById when loading existing record for update', async () => {
    const findById = vi.fn(async () => ({ id: 'task-1', title: 'Old title' }))

    const form = { entity: 'Task' } as any
    await checkFormAuthorization(form, 'update', { title: 'New title' }, session, blueprint, {
      findById,
    } as any, 'task-1')

    expect(findById).toHaveBeenCalledWith('Task', 'task-1', { session })
  })

  it('passes session to findById when loading existing record for delete', async () => {
    const findById = vi.fn(async () => ({ id: 'task-1', title: 'A task' }))

    const form = { entity: 'Task' } as any
    await checkFormAuthorization(form, 'delete', {}, session, blueprint, { findById } as any, 'task-1')

    expect(findById).toHaveBeenCalledWith('Task', 'task-1', { session })
  })

  it('does not call findById for create actions', async () => {
    const findById = vi.fn()

    const form = { entity: 'Task' } as any
    await checkFormAuthorization(form, 'create', { title: 'New' }, session, blueprint, {
      findById,
    } as any)

    expect(findById).not.toHaveBeenCalled()
  })
})
