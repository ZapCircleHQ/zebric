/**
 * Metrics Registry
 *
 * Collects in-memory metrics for Prometheus scraping.
 * Keeps implementation lightweight while providing the API
 * described in the engine specification.
 */

import { performance } from 'node:perf_hooks'

export type MetricSnapshot = {
  totalRequests: number
  requestDurations: {
    count: number
    sumMs: number
    buckets: Record<string, number>
  }
  requestsByRoute: Record<string, number>
  requestsByStatus: Record<string, number>
  queries: Record<
    string,
    {
      total: number
      sumMs: number
      buckets: Record<string, number>
      byAction: Record<string, number>
    }
  >
  routeCache: {
    hits: number
    misses: number
  }
  lastScrape: Date | null
}

const REQUEST_BUCKETS = [25, 50, 100, 250, 500, 1000, 2000] // ms
const QUERY_BUCKETS = [5, 10, 20, 50, 100, 250, 500] // ms

export class MetricsRegistry {
  private snapshot: MetricSnapshot = {
    totalRequests: 0,
    requestDurations: {
      count: 0,
      sumMs: 0,
      buckets: this.initBucketRecord(REQUEST_BUCKETS),
    },
    requestsByRoute: {},
    requestsByStatus: {},
    queries: {},
    routeCache: {
      hits: 0,
      misses: 0,
    },
    lastScrape: null,
  }

  private initBucketRecord(buckets: number[]): Record<string, number> {
    const record: Record<string, number> = {}
    for (const bucket of buckets) {
      record[`<=${bucket}`] = 0
    }
    record['+Inf'] = 0
    return record
  }

  recordRequest(route: string, statusCode: number, durationMs: number): void {
    this.snapshot.totalRequests += 1
    this.snapshot.requestDurations.count += 1
    this.snapshot.requestDurations.sumMs += durationMs
    this.bucketDuration(this.snapshot.requestDurations.buckets, durationMs, REQUEST_BUCKETS)

    this.snapshot.requestsByRoute[route] = (this.snapshot.requestsByRoute[route] || 0) + 1
    const statusKey = `${Math.floor(statusCode / 100)}xx`
    this.snapshot.requestsByStatus[statusKey] = (this.snapshot.requestsByStatus[statusKey] || 0) + 1
  }

  recordQuery(entity: string, action: string, durationMs: number): void {
    const entry =
      this.snapshot.queries[entity] ??
      (this.snapshot.queries[entity] = {
        total: 0,
        sumMs: 0,
        buckets: this.initBucketRecord(QUERY_BUCKETS),
        byAction: {},
      })

    entry.total += 1
    entry.sumMs += durationMs
    entry.byAction[action] = (entry.byAction[action] || 0) + 1
    this.bucketDuration(entry.buckets, durationMs, QUERY_BUCKETS)
  }

  recordRouteCacheHit(): void {
    this.snapshot.routeCache.hits += 1
  }

  recordRouteCacheMiss(): void {
    this.snapshot.routeCache.misses += 1
  }

  getSnapshot(): MetricSnapshot {
    return {
      ...this.snapshot,
      requestDurations: {
        ...this.snapshot.requestDurations,
        buckets: { ...this.snapshot.requestDurations.buckets },
      },
      requestsByRoute: { ...this.snapshot.requestsByRoute },
      requestsByStatus: { ...this.snapshot.requestsByStatus },
      queries: Object.fromEntries(
        Object.entries(this.snapshot.queries).map(([entity, data]) => [
          entity,
          {
            ...data,
            buckets: { ...data.buckets },
            byAction: { ...data.byAction },
          },
        ])
      ),
      routeCache: { ...this.snapshot.routeCache },
      lastScrape: this.snapshot.lastScrape ? new Date(this.snapshot.lastScrape) : null,
    }
  }

  toPrometheus(): string {
    const lines: string[] = []
    const snapshot = this.getSnapshot()

    lines.push('# HELP zbl_requests_total Total HTTP requests handled')
    lines.push('# TYPE zbl_requests_total counter')
    lines.push(`zbl_requests_total ${snapshot.totalRequests}`)

    lines.push('# HELP zbl_request_duration_ms Request duration in milliseconds')
    lines.push('# TYPE zbl_request_duration_ms histogram')
    let cumulative = 0
    for (const bucket of [...REQUEST_BUCKETS.map((b) => `<=${b}`), '+Inf']) {
      cumulative += snapshot.requestDurations.buckets[bucket]!
      const upper = bucket === '+Inf' ? '+Inf' : bucket.replace('<=', '')
      lines.push(
        `zbl_request_duration_ms_bucket{le="${upper}"} ${cumulative}`
      )
    }
    lines.push(
      `zbl_request_duration_ms_sum ${snapshot.requestDurations.sumMs.toFixed(3)}`
    )
    lines.push(`zbl_request_duration_ms_count ${snapshot.requestDurations.count}`)

    lines.push('# HELP zbl_requests_by_route_total Requests per route')
    lines.push('# TYPE zbl_requests_by_route_total counter')
    for (const [route, count] of Object.entries(snapshot.requestsByRoute)) {
      lines.push(`zbl_requests_by_route_total{route="${route}"} ${count}`)
    }

    lines.push('# HELP zbl_requests_by_status_total Requests grouped by status code family')
    lines.push('# TYPE zbl_requests_by_status_total counter')
    for (const [status, count] of Object.entries(snapshot.requestsByStatus)) {
      lines.push(`zbl_requests_by_status_total{status="${status}"} ${count}`)
    }

    lines.push('# HELP zbl_query_duration_ms Query execution duration in milliseconds')
    lines.push('# TYPE zbl_query_duration_ms histogram')
    for (const [entity, info] of Object.entries(snapshot.queries)) {
      cumulative = 0
      for (const bucket of [...QUERY_BUCKETS.map((b) => `<=${b}`), '+Inf']) {
        cumulative += info.buckets[bucket]!
        const upper = bucket === '+Inf' ? '+Inf' : bucket.replace('<=', '')
        lines.push(
          `zbl_query_duration_ms_bucket{entity="${entity}",le="${upper}"} ${cumulative}`
        )
      }
      lines.push(
        `zbl_query_duration_ms_sum{entity="${entity}"} ${info.sumMs.toFixed(3)}`
      )
      lines.push(
        `zbl_query_duration_ms_count{entity="${entity}"} ${info.total}`
      )
    }

    lines.push('# HELP zbl_route_cache_hits Total route cache hits')
    lines.push('# TYPE zbl_route_cache_hits counter')
    lines.push(`zbl_route_cache_hits ${snapshot.routeCache.hits}`)

    lines.push('# HELP zbl_route_cache_misses Total route cache misses')
    lines.push('# TYPE zbl_route_cache_misses counter')
    lines.push(`zbl_route_cache_misses ${snapshot.routeCache.misses}`)

    this.snapshot.lastScrape = new Date()
    return lines.join('\n') + '\n'
  }

  now(): number {
    return performance.now()
  }

  private bucketDuration(
    buckets: Record<string, number>,
    durationMs: number,
    threshold: number[]
  ): void {
    let bucketKey = '+Inf'
    for (const bound of threshold) {
      if (durationMs <= bound) {
        bucketKey = `<=${bound}`
        break
      }
    }
    buckets[bucketKey] = (buckets[bucketKey] || 0) + 1
  }
}
