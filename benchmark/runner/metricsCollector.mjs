export class BenchmarkMetrics {
  constructor() {
    this.operations = new Map()
    this.systemSamples = []
    this.backlogSamples = []
  }

  record(name, latencyMs, success, errorMessage) {
    const entry = this.operations.get(name) ?? {
      latencies: [],
      total: 0,
      success: 0,
      error: 0,
      errors: [],
    }
    entry.total += 1
    if (success) entry.success += 1
    else entry.error += 1
    entry.latencies.push(latencyMs)
    if (errorMessage) entry.errors.push(errorMessage)
    this.operations.set(name, entry)
  }

  sampleSystem(sample) {
    this.systemSamples.push(sample)
  }

  sampleBacklog(sample) {
    this.backlogSamples.push(sample)
  }
}

export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

export function summarizeMetrics(metrics) {
  const operations = {}
  let totalOperations = 0
  let totalErrors = 0
  for (const [name, entry] of metrics.operations.entries()) {
    totalOperations += entry.total
    totalErrors += entry.error
    operations[name] = {
      total: entry.total,
      success: entry.success,
      error: entry.error,
      p50: percentile(entry.latencies, 50),
      p95: percentile(entry.latencies, 95),
      p99: percentile(entry.latencies, 99),
      mean: entry.latencies.length ? entry.latencies.reduce((sum, value) => sum + value, 0) / entry.latencies.length : 0,
      sampleErrors: entry.errors.slice(0, 5),
    }
  }

  const memoryValues = metrics.systemSamples.map((sample) => sample.rssMb)
  const backlogPeaks = metrics.backlogSamples.reduce((peak, sample) => ({
    pendingWorkflowCount: Math.max(peak.pendingWorkflowCount, sample.pendingWorkflowCount),
    pendingNotificationCount: Math.max(peak.pendingNotificationCount, sample.pendingNotificationCount),
    webhookBacklogCount: Math.max(peak.webhookBacklogCount, sample.webhookBacklogCount),
  }), {
    pendingWorkflowCount: 0,
    pendingNotificationCount: 0,
    webhookBacklogCount: 0,
  })

  return {
    totalOperations,
    totalErrors,
    errorRate: totalOperations ? totalErrors / totalOperations : 0,
    operations,
    system: {
      peakRssMb: memoryValues.length ? Math.max(...memoryValues) : 0,
      peakHeapMb: metrics.systemSamples.length ? Math.max(...metrics.systemSamples.map((sample) => sample.heapUsedMb)) : 0,
      peakEventLoopLagMs: metrics.systemSamples.length ? Math.max(...metrics.systemSamples.map((sample) => sample.eventLoopLagMs)) : 0,
    },
    backlog: backlogPeaks,
  }
}
