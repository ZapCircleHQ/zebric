import { describe, expect, it, vi } from 'vitest'
import { handleLookupSearch, resolveLookupConfig } from './handler.js'
import type { Blueprint } from '../../types/blueprint.js'

const request = { method: 'GET', url: '/_zebric/lookup', headers: {} }

function blueprint(): Blueprint {
  return {
    version: '1',
    project: { name: 'test', version: '1', runtime: { min_version: '1' } },
    entities: [],
    pages: [
      {
        path: '/orders/new',
        title: 'New order',
        form: {
          entity: 'Order',
          fields: [{
            name: 'customerId',
            type: 'lookup',
            lookup: {
              entity: 'Customer',
              search: ['firstName', 'lastName'],
              display: '{lastName}, {firstName}',
              limit: 5,
              filter: { active: true },
            },
          }],
        } as any,
      },
      {
        path: '/customers',
        title: 'Customers',
        widget: {
          kind: 'lookup',
          entity: 'Customer',
          search: ['name'],
          display: '{name}',
          limit: 10,
          filter: { active: true },
        } as any,
      },
    ],
  }
}

function queryExecutor(overrides: Record<string, any> = {}) {
  return {
    execute: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findById: vi.fn(),
    search: vi.fn(),
    ...overrides,
  }
}

describe('resolveLookupConfig', () => {
  it('resolves form-field and widget lookup configurations', () => {
    expect(resolveLookupConfig(blueprint(), '/orders/new', 'customerId')).toEqual({
      entity: 'Customer',
      search: ['firstName', 'lastName'],
      display: '{lastName}, {firstName}',
      limit: 5,
      filter: { active: true },
    })
    expect(resolveLookupConfig(blueprint(), '/customers')).toEqual({
      entity: 'Customer',
      search: ['name'],
      display: '{name}',
      limit: 10,
      filter: { active: true },
    })
  })

  it('returns null for missing pages, fields, and invalid widget configurations', () => {
    const invalid = blueprint()
    ;(invalid.pages[1].widget as any).search = 'name'

    expect(resolveLookupConfig(blueprint(), '/missing')).toBeNull()
    expect(resolveLookupConfig(blueprint(), '/orders/new', 'missing')).toBeNull()
    expect(resolveLookupConfig(invalid, '/customers')).toBeNull()
  })
})

describe('handleLookupSearch', () => {
  it('rejects requests without a page or configured lookup', async () => {
    const executor = queryExecutor()

    expect(await handleLookupSearch(blueprint(), {}, request, { queryExecutor: executor }))
      .toEqual({ status: 400, body: { error: 'Missing page' } })
    expect(await handleLookupSearch(
      blueprint(), { page: '/missing' }, request, { queryExecutor: executor },
    )).toEqual({ status: 404, body: { error: 'No lookup configured for this page/field' } })
    expect(executor.search).not.toHaveBeenCalled()
  })

  it('searches with the session and shapes records for the client', async () => {
    const records = [
      { id: 'customer-1', firstName: 'Ada', lastName: 'Lovelace' },
      { id: 'customer-2', firstName: 'Grace', lastName: 'Hopper' },
    ]
    const executor = queryExecutor({ search: vi.fn().mockResolvedValue(records) })
    const session = { user: { id: 'user-1', email: 'user@example.test' } } as any
    const getSession = vi.fn().mockResolvedValue(session)

    const result = await handleLookupSearch(blueprint(), {
      page: '/orders/new', field: 'customerId', q: 'lo',
    }, request, {
      queryExecutor: executor,
      sessionManager: { getSession },
    })

    expect(getSession).toHaveBeenCalledWith(request)
    expect(executor.search).toHaveBeenCalledWith(
      'Customer', ['firstName', 'lastName'], 'lo', {
        limit: 5,
        filter: { active: true },
        context: { session },
      },
    )
    expect(result).toEqual({ status: 200, body: { results: [
      { id: 'customer-1', label: 'Lovelace, Ada' },
      { id: 'customer-2', label: 'Hopper, Grace' },
    ] } })
  })

  it('uses an empty query and null session by default', async () => {
    const executor = queryExecutor({ search: vi.fn().mockResolvedValue([]) })

    await handleLookupSearch(
      blueprint(), { page: '/customers' }, request, { queryExecutor: executor },
    )

    expect(executor.search).toHaveBeenCalledWith(
      'Customer', ['name'], '', expect.objectContaining({ context: { session: null } }),
    )
  })

  it.each([
    [new Error('database unavailable'), 'database unavailable'],
    ['failure', 'Unknown error'],
  ])('returns a safe error when search fails', async (error, details) => {
    const executor = queryExecutor({ search: vi.fn().mockRejectedValue(error) })

    const result = await handleLookupSearch(
      blueprint(), { page: '/customers', q: 'ada' }, request, { queryExecutor: executor },
    )

    expect(result).toEqual({
      status: 500,
      body: { error: 'Search failed', details },
    })
  })
})
