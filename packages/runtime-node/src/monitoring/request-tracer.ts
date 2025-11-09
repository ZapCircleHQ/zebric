/**
 * Request Tracer
 *
 * Provides distributed tracing for requests flowing through the ZBL Engine.
 * Tracks the complete lifecycle of a request from HTTP entry to database queries.
 */

import { performance } from 'node:perf_hooks'

/**
 * Span types for different operations
 */
export enum SpanType {
  HTTP_REQUEST = 'http.request',
  ROUTE_MATCH = 'route.match',
  AUTH_CHECK = 'auth.check',
  PERMISSION_CHECK = 'permission.check',
  QUERY = 'query',
  BEHAVIOR = 'behavior',
  WORKFLOW = 'workflow',
  CACHE_LOOKUP = 'cache.lookup',
  PLUGIN = 'plugin',
}

/**
 * Span status
 */
export enum SpanStatus {
  OK = 'ok',
  ERROR = 'error',
}

/**
 * Individual span within a trace
 */
export interface Span {
  spanId: string
  parentSpanId?: string
  type: SpanType
  name: string
  startTime: number
  endTime?: number
  duration?: number
  status: SpanStatus
  attributes: Record<string, any>
  events: SpanEvent[]
}

/**
 * Event within a span
 */
export interface SpanEvent {
  timestamp: number
  name: string
  attributes?: Record<string, any>
}

/**
 * Complete trace for a request
 */
export interface Trace {
  traceId: string
  startTime: number
  endTime?: number
  duration?: number
  spans: Span[]
  metadata: {
    method: string
    path: string
    statusCode?: number
    userId?: string
    error?: string
  }
}

/**
 * Active span context
 */
interface SpanContext {
  span: Span
  startMark: number
}

/**
 * Request Tracer - Manages traces and spans
 */
export class RequestTracer {
  private traces = new Map<string, Trace>()
  private activeSpans = new Map<string, SpanContext>()
  private maxTraces = 1000 // Keep last 1000 traces
  private maxTraceDuration = 5 * 60 * 1000 // 5 minutes

  /**
   * Start a new trace for a request
   */
  startTrace(traceId: string, method: string, path: string): void {
    const trace: Trace = {
      traceId,
      startTime: Date.now(),
      spans: [],
      metadata: {
        method,
        path,
      },
    }

    this.traces.set(traceId, trace)
    this.cleanupOldTraces()
  }

  /**
   * End a trace
   */
  endTrace(traceId: string, statusCode: number, error?: string): void {
    const trace = this.traces.get(traceId)
    if (!trace) return

    trace.endTime = Date.now()
    trace.duration = trace.endTime - trace.startTime
    trace.metadata.statusCode = statusCode
    if (error) {
      trace.metadata.error = error
    }

    // Close any open spans
    for (const [spanId] of this.activeSpans.entries()) {
      if (spanId.startsWith(traceId)) {
        this.endSpan(spanId, SpanStatus.ERROR, { error: 'Span not closed before trace end' })
      }
    }
  }

  /**
   * Start a new span within a trace
   */
  startSpan(
    traceId: string,
    type: SpanType,
    name: string,
    attributes: Record<string, any> = {},
    parentSpanId?: string
  ): string {
    const trace = this.traces.get(traceId)
    if (!trace) {
      console.warn(`[TRACER] Trace ${traceId} not found, cannot start span`)
      return ''
    }

    const spanId = `${traceId}-${trace.spans.length}`
    const span: Span = {
      spanId,
      parentSpanId,
      type,
      name,
      startTime: Date.now(),
      status: SpanStatus.OK,
      attributes,
      events: [],
    }

    trace.spans.push(span)
    this.activeSpans.set(spanId, {
      span,
      startMark: performance.now(),
    })

    return spanId
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status: SpanStatus = SpanStatus.OK, attributes: Record<string, any> = {}): void {
    const context = this.activeSpans.get(spanId)
    if (!context) {
      console.warn(`[TRACER] Span ${spanId} not found`)
      return
    }

    const endMark = performance.now()
    context.span.endTime = Date.now()
    context.span.duration = endMark - context.startMark
    context.span.status = status

    // Merge additional attributes
    Object.assign(context.span.attributes, attributes)

    this.activeSpans.delete(spanId)
  }

  /**
   * Add an event to a span
   */
  addSpanEvent(spanId: string, name: string, attributes?: Record<string, any>): void {
    const context = this.activeSpans.get(spanId)
    if (!context) return

    context.span.events.push({
      timestamp: Date.now(),
      name,
      attributes,
    })
  }

  /**
   * Set span attributes
   */
  setSpanAttributes(spanId: string, attributes: Record<string, any>): void {
    const context = this.activeSpans.get(spanId)
    if (!context) return

    Object.assign(context.span.attributes, attributes)
  }

  /**
   * Get a trace by ID
   */
  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId)
  }

  /**
   * Get all traces (most recent first)
   */
  getAllTraces(limit: number = 100): Trace[] {
    const traces = Array.from(this.traces.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit)

    return traces
  }

  /**
   * Get traces by path
   */
  getTracesByPath(path: string, limit: number = 100): Trace[] {
    return Array.from(this.traces.values())
      .filter(trace => trace.metadata.path === path)
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit)
  }

  /**
   * Get traces with errors
   */
  getErrorTraces(limit: number = 100): Trace[] {
    return Array.from(this.traces.values())
      .filter(trace =>
        trace.metadata.error ||
        trace.metadata.statusCode && trace.metadata.statusCode >= 400
      )
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit)
  }

  /**
   * Get slow traces (above threshold)
   */
  getSlowTraces(thresholdMs: number = 1000, limit: number = 100): Trace[] {
    return Array.from(this.traces.values())
      .filter(trace => trace.duration && trace.duration > thresholdMs)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, limit)
  }

  /**
   * Clear all traces
   */
  clearTraces(): void {
    this.traces.clear()
    this.activeSpans.clear()
  }

  /**
   * Get statistics about traces
   */
  getStats(): {
    totalTraces: number
    activeSpans: number
    errorCount: number
    avgDuration: number
    p50Duration: number
    p95Duration: number
    p99Duration: number
  } {
    const traces = Array.from(this.traces.values())
    const completedTraces = traces.filter(t => t.duration !== undefined)
    const durations = completedTraces.map(t => t.duration!).sort((a, b) => a - b)

    const errorCount = traces.filter(t =>
      t.metadata.error || (t.metadata.statusCode && t.metadata.statusCode >= 400)
    ).length

    const sum = durations.reduce((acc, d) => acc + d, 0)
    const avg = durations.length > 0 ? sum / durations.length : 0

    const p50 = durations[Math.floor(durations.length * 0.5)] || 0
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0

    return {
      totalTraces: traces.length,
      activeSpans: this.activeSpans.size,
      errorCount,
      avgDuration: avg,
      p50Duration: p50,
      p95Duration: p95,
      p99Duration: p99,
    }
  }

  /**
   * Cleanup old traces to prevent memory leaks
   */
  private cleanupOldTraces(): void {
    if (this.traces.size <= this.maxTraces) return

    const traces = Array.from(this.traces.entries())
      .sort(([, a], [, b]) => b.startTime - a.startTime)

    // Keep only the most recent maxTraces
    const toDelete = traces.slice(this.maxTraces)
    for (const [traceId] of toDelete) {
      this.traces.delete(traceId)
    }

    // Also remove traces older than maxTraceDuration
    const now = Date.now()
    for (const [traceId, trace] of this.traces.entries()) {
      if (now - trace.startTime > this.maxTraceDuration) {
        this.traces.delete(traceId)
      }
    }
  }
}
