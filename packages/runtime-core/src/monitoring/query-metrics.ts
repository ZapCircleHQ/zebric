import type { QueryExecutorPort } from '../routing/request-ports.js'
import type { MetricsRegistry } from './metrics.js'

/** Measure the public query boundary without changing transactional callback ownership. */
export function instrumentQueries<T extends QueryExecutorPort>(executor: T, metrics: MetricsRegistry): T {
  const actions: Record<string, string> = { execute: 'read', findById: 'read', search: 'search', create: 'create', update: 'update', delete: 'delete' }
  return new Proxy(executor, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const action = actions[String(property)]
      if (!action) return value.bind(target)
      return async (...args: unknown[]) => {
        const start = metrics.now()
        try { return await value.apply(target, args) }
        finally {
          const entity = typeof args[0] === 'string' ? args[0] : (args[0] as { entity: string }).entity
          metrics.recordQuery(entity, action, metrics.now() - start)
        }
      }
    },
  })
}
