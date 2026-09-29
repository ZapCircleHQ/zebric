import { describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { createServiceRegistry } from './service-registry.js'

describe('plugin-backed service registry', () => {
  it('resolves a declared operation from a plugin integration at invocation time', async () => {
    const search = vi.fn().mockResolvedValue({ count: 2 })
    const plugins = {
      get: vi.fn().mockReturnValue({
        plugin: { integrations: { places: { search } } },
      }),
    }
    const blueprint: Blueprint = {
      version: '1',
      project: { name: 'services', version: '0.6.0', runtime: { min_version: '0.6.0' } },
      entities: [],
      pages: [],
      services: [{
        name: 'places',
        plugin: 'google-places',
        operations: {
          search: {
            input: { query: { type: 'Text', required: true } },
            result: {
              type: 'Object',
              fields: { count: { type: 'Integer', required: true } },
            },
          },
        },
      }],
    }

    const registry = createServiceRegistry(blueprint, plugins as any)
    await expect(registry.invoke('places', 'search', { query: 'coffee' })).resolves.toEqual({ count: 2 })
    expect(plugins.get).toHaveBeenCalledWith('google-places')
    expect(search).toHaveBeenCalledWith({ query: 'coffee' }, expect.any(Object))
  })
})
