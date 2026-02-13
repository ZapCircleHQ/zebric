import { describe, it, expect, vi } from 'vitest'
import { RequestTracer, SpanStatus, SpanType } from './request-tracer.js'

describe('RequestTracer', () => {
  it('starts and ends traces with metadata and duration', () => {
    const tracer = new RequestTracer()

    tracer.startTrace('t1', 'GET', '/items')
    tracer.endTrace('t1', 200)

    const trace = tracer.getTrace('t1')
    expect(trace).toBeDefined()
    expect(trace?.metadata.method).toBe('GET')
    expect(trace?.metadata.path).toBe('/items')
    expect(trace?.metadata.statusCode).toBe(200)
    expect(trace?.duration).toBeTypeOf('number')
  })

  it('records trace errors when provided', () => {
    const tracer = new RequestTracer()

    tracer.startTrace('t1', 'POST', '/items')
    tracer.endTrace('t1', 500, 'boom')

    expect(tracer.getTrace('t1')?.metadata.error).toBe('boom')
  })

  it('creates spans, updates attributes, and records events', () => {
    const tracer = new RequestTracer()
    tracer.startTrace('t1', 'GET', '/x')

    const spanId = tracer.startSpan('t1', SpanType.QUERY, 'select', { table: 'users' })
    tracer.addSpanEvent(spanId, 'started', { at: 1 })
    tracer.setSpanAttributes(spanId, { rows: 2 })
    tracer.endSpan(spanId, SpanStatus.OK, { cached: false })

    const span = tracer.getTrace('t1')?.spans[0]
    expect(span?.type).toBe(SpanType.QUERY)
    expect(span?.name).toBe('select')
    expect(span?.attributes).toMatchObject({ table: 'users', rows: 2, cached: false })
    expect(span?.events).toHaveLength(1)
    expect(span?.events[0]?.name).toBe('started')
    expect(span?.status).toBe(SpanStatus.OK)
    expect(span?.duration).toBeTypeOf('number')
  })

  it('closes open spans as errors when ending a trace', () => {
    const tracer = new RequestTracer()
    tracer.startTrace('trace1', 'GET', '/a')
    const openSpanId = tracer.startSpan('trace1', SpanType.BEHAVIOR, 'run')

    tracer.endTrace('trace1', 500, 'failed')

    const span = tracer.getTrace('trace1')?.spans.find(s => s.spanId === openSpanId)
    expect(span?.status).toBe(SpanStatus.ERROR)
    expect(span?.attributes.error).toContain('not closed')
  })

  it('returns empty span id and warns when starting span for missing trace', () => {
    const tracer = new RequestTracer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const spanId = tracer.startSpan('missing', SpanType.HTTP_REQUEST, 'request')

    expect(spanId).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns when ending a missing span', () => {
    const tracer = new RequestTracer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    tracer.endSpan('missing-span')

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('filters traces by path, error state, and slow duration', async () => {
    const tracer = new RequestTracer()

    tracer.startTrace('ok', 'GET', '/items')
    tracer.endTrace('ok', 200)

    tracer.startTrace('bad', 'GET', '/items')
    tracer.endTrace('bad', 500, 'server error')

    tracer.startTrace('slow', 'GET', '/slow')
    await new Promise(resolve => setTimeout(resolve, 10))
    tracer.endTrace('slow', 200)

    expect(tracer.getTracesByPath('/items').map(t => t.traceId).sort()).toEqual(['bad', 'ok'])
    expect(tracer.getErrorTraces().some(t => t.traceId === 'bad')).toBe(true)
    expect(tracer.getSlowTraces(1).some(t => t.traceId === 'slow')).toBe(true)
  })

  it('computes stats and supports clearing traces', () => {
    const tracer = new RequestTracer()

    tracer.startTrace('t1', 'GET', '/ok')
    tracer.endTrace('t1', 200)

    tracer.startTrace('t2', 'GET', '/err')
    tracer.endTrace('t2', 500, 'oops')

    const stats = tracer.getStats()
    expect(stats.totalTraces).toBe(2)
    expect(stats.errorCount).toBe(1)
    expect(stats.avgDuration).toBeGreaterThanOrEqual(0)
    expect(stats.p50Duration).toBeGreaterThanOrEqual(0)
    expect(stats.p95Duration).toBeGreaterThanOrEqual(0)
    expect(stats.p99Duration).toBeGreaterThanOrEqual(0)

    tracer.clearTraces()
    expect(tracer.getAllTraces()).toHaveLength(0)
    expect(tracer.getStats().activeSpans).toBe(0)
  })

  it('keeps only most recent traces when max size is exceeded', async () => {
    const tracer = new RequestTracer() as any
    tracer.maxTraces = 2

    tracer.startTrace('t1', 'GET', '/1')
    await new Promise(resolve => setTimeout(resolve, 2))
    tracer.startTrace('t2', 'GET', '/2')
    await new Promise(resolve => setTimeout(resolve, 2))
    tracer.startTrace('t3', 'GET', '/3')

    const ids = tracer.getAllTraces(10).map((t: any) => t.traceId).sort()
    expect(ids).toEqual(['t2', 't3'])
  })

  it('removes traces older than maxTraceDuration during cleanup', () => {
    const tracer = new RequestTracer() as any
    tracer.maxTraces = 1
    tracer.maxTraceDuration = 1

    tracer.startTrace('old', 'GET', '/old')
    const oldTrace = tracer.getTrace('old')
    if (oldTrace) {
      oldTrace.startTime = Date.now() - 10_000
    }

    tracer.startTrace('new', 'GET', '/new')

    expect(tracer.getTrace('old')).toBeUndefined()
    expect(tracer.getTrace('new')).toBeDefined()
  })
})
