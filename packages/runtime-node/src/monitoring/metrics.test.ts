import { describe, expect, it } from 'vitest'
import { MetricsRegistry } from './metrics.js'

describe('MetricsRegistry', () => {
  it('records requests by route/status and buckets duration', () => {
    const metrics = new MetricsRegistry()

    metrics.recordRequest('/users', 200, 20)
    metrics.recordRequest('/users', 404, 260)
    metrics.recordRequest('/posts', 500, 3000)

    const s = metrics.getSnapshot()
    expect(s.totalRequests).toBe(3)
    expect(s.requestDurations.count).toBe(3)
    expect(s.requestDurations.sumMs).toBe(3280)
    expect(s.requestDurations.buckets['<=25']).toBe(1)
    expect(s.requestDurations.buckets['<=500']).toBe(1)
    expect(s.requestDurations.buckets['+Inf']).toBe(1)
    expect(s.requestsByRoute).toEqual({ '/users': 2, '/posts': 1 })
    expect(s.requestsByStatus).toEqual({ '2xx': 1, '4xx': 1, '5xx': 1 })
  })

  it('records query metrics and per-action counts', () => {
    const metrics = new MetricsRegistry()

    metrics.recordQuery('User', 'findMany', 8)
    metrics.recordQuery('User', 'insert', 90)
    metrics.recordQuery('Post', 'findMany', 600)

    const s = metrics.getSnapshot()
    expect(s.queries.User?.total).toBe(2)
    expect(s.queries.User?.sumMs).toBe(98)
    expect(s.queries.User?.byAction).toEqual({ findMany: 1, insert: 1 })
    expect(s.queries.User?.buckets['<=10']).toBe(1)
    expect(s.queries.User?.buckets['<=100']).toBe(1)
    expect(s.queries.Post?.buckets['+Inf']).toBe(1)
  })

  it('tracks route cache hits and misses', () => {
    const metrics = new MetricsRegistry()
    metrics.recordRouteCacheHit()
    metrics.recordRouteCacheHit()
    metrics.recordRouteCacheMiss()

    expect(metrics.getSnapshot().routeCache).toEqual({ hits: 2, misses: 1 })
  })

  it('returns deep-cloned snapshots', () => {
    const metrics = new MetricsRegistry()
    metrics.recordRequest('/x', 200, 15)
    metrics.recordQuery('User', 'findMany', 10)

    const first = metrics.getSnapshot()
    first.totalRequests = 999
    first.requestDurations.buckets['<=25'] = 999
    first.requestsByRoute['/x'] = 999
    if (first.queries.User) {
      first.queries.User.total = 999
      first.queries.User.byAction.findMany = 999
    }

    const second = metrics.getSnapshot()
    expect(second.totalRequests).toBe(1)
    expect(second.requestDurations.buckets['<=25']).toBe(1)
    expect(second.requestsByRoute['/x']).toBe(1)
    expect(second.queries.User?.total).toBe(1)
    expect(second.queries.User?.byAction.findMany).toBe(1)
  })

  it('exports prometheus format and updates lastScrape', () => {
    const metrics = new MetricsRegistry()
    metrics.recordRequest('/users', 200, 42)
    metrics.recordQuery('User', 'findMany', 12)
    metrics.recordRouteCacheHit()
    metrics.recordRouteCacheMiss()

    const text = metrics.toPrometheus()
    expect(text).toContain('# HELP zbl_requests_total')
    expect(text).toContain('zbl_requests_total 1')
    expect(text).toContain('zbl_requests_by_route_total{route="/users"} 1')
    expect(text).toContain('zbl_requests_by_status_total{status="2xx"} 1')
    expect(text).toContain('zbl_query_duration_ms_count{entity="User"} 1')
    expect(text).toContain('zbl_route_cache_hits 1')
    expect(text.endsWith('\n')).toBe(true)

    expect(metrics.getSnapshot().lastScrape).not.toBeNull()
  })

  it('exposes current monotonic time', () => {
    const metrics = new MetricsRegistry()
    expect(metrics.now()).toBeTypeOf('number')
  })
})
