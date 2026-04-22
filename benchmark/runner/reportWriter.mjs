import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function writeBenchmarkReport(outputPath, report) {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2))

  const latestPath = resolve(dirname(outputPath), 'latest.json')
  writeFileSync(latestPath, JSON.stringify(report, null, 2))
}

export function printBenchmarkSummary(report) {
  const majorOps = ['listRequests', 'openRequestDetail', 'createRequest', 'addComment', 'receiveWebhook', 'processWorkflow', 'sendNotification']
  console.log(`Profile: ${report.profile} | Topology: ${report.topology}`)
  console.log(`Throughput: ${report.totalOperations} ops in ${report.duration}s`)
  console.log(`Error rate: ${(report.errorRate * 100).toFixed(2)}%`)
  console.log(`Peak RSS: ${report.systemMetricsSummary.peakRssMb.toFixed(1)} MB`)
  console.log(`Backlog peaks: workflow=${report.backlogSummary.pendingWorkflowCount}, notification=${report.backlogSummary.pendingNotificationCount}, webhook=${report.backlogSummary.webhookBacklogCount}`)
  for (const name of majorOps) {
    const summary = report.latencySummaryByOperation[name]
    if (summary) {
      console.log(`${name}: p95=${summary.p95.toFixed(1)}ms p99=${summary.p99.toFixed(1)}ms errors=${summary.error}`)
    }
  }
  console.log(`Verdict: ${report.verdict}`)
  console.log(`Likely bottleneck: ${report.bottleneckNotes.join('; ') || 'none detected'}`)
}
