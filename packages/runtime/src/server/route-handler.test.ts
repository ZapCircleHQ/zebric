/**
 * Route Handler Tests
 *
 * Focus: form authorization logic, ensuring entity lookup uses name rather than object indexing.
 */

import { describe, it, expect } from 'vitest'
import { RouteHandler } from './route-handler.js'
import type { Blueprint, Form } from '../types/blueprint.js'

const createTestBlueprint = (): Blueprint => ({
  version: '0.1.0',
  project: {
    name: 'Test App',
    version: '1.0.0',
    runtime: { min_version: '0.1.0' }
  },
  entities: [
    {
      name: 'Task',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'title', type: 'Text', required: true }
      ]
    }
  ],
  pages: [
    {
      path: '/tasks/new',
      title: 'New Task',
      auth: 'optional',
      layout: 'form',
      form: {
        entity: 'Task',
        method: 'create',
        fields: []
      }
    }
  ]
})

describe('RouteHandler - form authorization', () => {
  it('allows anonymous create when entity exists in blueprint', async () => {
    const blueprint = createTestBlueprint()
    const handler = new RouteHandler(blueprint)

    const form = blueprint.pages[0].form as Form
    const result = await (handler as any).checkFormAuthorization(
      form,
      'create',
      { title: 'Test Task' },
      null
    )

    expect(result).toBe(true)
  })

  it('denies authorization when entity is missing from blueprint', async () => {
    const blueprint = createTestBlueprint()
    const handler = new RouteHandler(blueprint)

    const ghostForm: Form = {
      entity: 'Ghost',
      method: 'create',
      fields: []
    }

    const result = await (handler as any).checkFormAuthorization(
      ghostForm,
      'create',
      { title: 'Should fail' },
      null
    )

    expect(result).toBe(false)
  })
})

