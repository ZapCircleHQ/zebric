import { describe, expect, it, vi } from 'vitest'
import {
  ExternalResultValidationError,
  ServiceFailureError,
  ValidationFailureError,
} from '../errors/domain-errors.js'
import { ServiceRegistry } from './registry.js'

const services = [{
  name: 'places',
  plugin: 'google-places',
  operations: {
    search: {
      input: {
        query: { type: 'Text' as const, required: true },
      },
      result: {
        type: 'Object' as const,
        fields: {
          candidates: {
            type: 'Array' as const,
            required: true,
            items: {
              type: 'Object' as const,
              fields: {
                placeId: { type: 'Text' as const, required: true },
                displayName: { type: 'Text' as const, required: true },
              },
            },
          },
          count: { type: 'Integer' as const, required: true },
        },
      },
      transform: {
        places: '$result.candidates',
        total: '$result.count',
        query: '$input.query',
      },
    },
  },
}]

describe('ServiceRegistry', () => {
  it('validates external results before applying a transform', async () => {
    const registry = new ServiceRegistry(services)
    registry.register('places', 'search', async () => ({
      candidates: [{ placeId: 'p1', displayName: 'Zebric Coffee' }],
      count: 1,
    }))

    await expect(registry.invoke('places', 'search', { query: 'coffee' })).resolves.toEqual({
      places: [{ placeId: 'p1', displayName: 'Zebric Coffee' }],
      total: 1,
      query: 'coffee',
    })
  })

  it('rejects malformed external data instead of treating parsed JSON as trusted', async () => {
    const registry = new ServiceRegistry(services)
    registry.register('places', 'search', async () => ({ candidates: [], count: 'many' }))

    await expect(registry.invoke('places', 'search', { query: 'coffee' }))
      .rejects.toBeInstanceOf(ExternalResultValidationError)
  })

  it('validates operation input before calling the integration', async () => {
    const handler = vi.fn()
    const registry = new ServiceRegistry(services)
    registry.register('places', 'search', handler)

    await expect(registry.invoke('places', 'search', {})).rejects.toBeInstanceOf(ValidationFailureError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('normalizes integration failures and emits service spans', async () => {
    const observer = { startSpan: vi.fn(() => 'span'), endSpan: vi.fn() }
    const registry = new ServiceRegistry(services, { observer })
    registry.register('places', 'search', async () => { throw new Error('provider unavailable') })

    await expect(registry.invoke('places', 'search', { query: 'coffee' }, { correlationId: 'trace-1' }))
      .rejects.toBeInstanceOf(ServiceFailureError)
    expect(observer.startSpan).toHaveBeenCalledWith('zebric.service', {
      'zebric.service.name': 'places',
      'zebric.service.operation': 'search',
    }, 'trace-1')
    expect(observer.endSpan).toHaveBeenCalledWith('span', expect.any(Error))
  })

  it('can resolve plugin-backed handlers lazily', async () => {
    const handler = vi.fn(async () => ({ candidates: [], count: 0 }))
    const registry = new ServiceRegistry(services, {
      resolveHandler: (_service, operation) => operation === 'search' ? handler : undefined,
    })

    await registry.invoke('places', 'search', { query: 'coffee' })
    expect(handler).toHaveBeenCalledOnce()
  })
})
