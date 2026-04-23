import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, basename } from 'node:path'

function listReportFiles(inputPath) {
  const resolved = resolve(process.cwd(), inputPath)
  const stat = statSync(resolved)
  if (stat.isDirectory()) {
    return readdirSync(resolved)
      .filter((name) => name.endsWith('.json'))
      .map((name) => resolve(resolved, name))
      .sort()
  }
  return [resolved]
}

function loadReports(inputPath) {
  return listReportFiles(inputPath)
    .map((file) => ({
      file,
      report: JSON.parse(readFileSync(file, 'utf8')),
    }))
    .filter(({ report }) => report && report.latencySummaryByOperation)
}

function updateCounter(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function toSortedEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`
}

export function analyzeReports(inputPath = 'benchmark/results') {
  const entries = loadReports(inputPath)
  if (entries.length === 0) {
    throw new Error(`No benchmark reports found in ${inputPath}`)
  }

  const operationStats = new Map()
  const errorPatterns = new Map()
  const verdicts = new Map()
  let highestBacklog = {
    workflow: { value: 0, file: null },
    notification: { value: 0, file: null },
    webhook: { value: 0, file: null },
  }

  for (const { file, report } of entries) {
    updateCounter(verdicts, report.verdict ?? 'unknown')

    const backlog = report.backlogSummary ?? {}
    if ((backlog.pendingWorkflowCount ?? 0) > highestBacklog.workflow.value) {
      highestBacklog.workflow = { value: backlog.pendingWorkflowCount, file }
    }
    if ((backlog.pendingNotificationCount ?? 0) > highestBacklog.notification.value) {
      highestBacklog.notification = { value: backlog.pendingNotificationCount, file }
    }
    if ((backlog.webhookBacklogCount ?? 0) > highestBacklog.webhook.value) {
      highestBacklog.webhook = { value: backlog.webhookBacklogCount, file }
    }

    for (const [operation, summary] of Object.entries(report.latencySummaryByOperation ?? {})) {
      const current = operationStats.get(operation) ?? {
        samples: 0,
        failures: 0,
        p95Total: 0,
        p99Total: 0,
        meanTotal: 0,
        worstP95: { value: 0, file: null },
      }

      current.samples += 1
      current.failures += summary.error ?? 0
      current.p95Total += summary.p95 ?? 0
      current.p99Total += summary.p99 ?? 0
      current.meanTotal += summary.mean ?? 0

      if ((summary.p95 ?? 0) > current.worstP95.value) {
        current.worstP95 = { value: summary.p95, file }
      }

      for (const sample of summary.sampleErrors ?? []) {
        const normalized = String(sample).slice(0, 160)
        updateCounter(errorPatterns, `${operation}: ${normalized}`)
      }

      operationStats.set(operation, current)
    }
  }

  const rankedOperations = [...operationStats.entries()]
    .map(([operation, stat]) => ({
      operation,
      avgP95: stat.p95Total / stat.samples,
      avgP99: stat.p99Total / stat.samples,
      avgMean: stat.meanTotal / stat.samples,
      failures: stat.failures,
      worstP95: stat.worstP95,
    }))
    .sort((left, right) => {
      if (right.failures !== left.failures) return right.failures - left.failures
      return right.avgP95 - left.avgP95
    })

  console.log(`Reports analyzed: ${entries.length}`)
  console.log(`Verdicts: ${toSortedEntries(verdicts).map(([name, count]) => `${name}=${count}`).join(', ')}`)
  console.log('')

  console.log('Top operation hotspots:')
  for (const item of rankedOperations.slice(0, 8)) {
    const worstFile = item.worstP95.file ? basename(item.worstP95.file) : 'n/a'
    console.log(
      `- ${item.operation}: failures=${item.failures}, avg p95=${formatMs(item.avgP95)}, avg p99=${formatMs(item.avgP99)}, worst p95=${formatMs(item.worstP95.value)} in ${worstFile}`
    )
  }

  console.log('')
  console.log('Recurring error patterns:')
  for (const [pattern, count] of toSortedEntries(errorPatterns, 8)) {
    console.log(`- ${pattern} (${count})`)
  }

  console.log('')
  console.log('Peak backlog observations:')
  console.log(`- workflow backlog: ${highestBacklog.workflow.value} in ${highestBacklog.workflow.file ? basename(highestBacklog.workflow.file) : 'n/a'}`)
  console.log(`- notification backlog: ${highestBacklog.notification.value} in ${highestBacklog.notification.file ? basename(highestBacklog.notification.file) : 'n/a'}`)
  console.log(`- webhook backlog: ${highestBacklog.webhook.value} in ${highestBacklog.webhook.file ? basename(highestBacklog.webhook.file) : 'n/a'}`)
}
