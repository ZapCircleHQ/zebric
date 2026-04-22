export default {
  name: 'webhook-storm',
  description: 'Webhook-heavy benchmark with lower interactive pressure and elevated async churn.',
  durationSeconds: 420,
  concurrency: 70,
  rampStages: [
    { untilSeconds: 90, concurrency: 20 },
    { untilSeconds: 180, concurrency: 40 },
    { untilSeconds: Number.POSITIVE_INFINITY, concurrency: 70 },
  ],
  webhook: {
    burstSize: 32,
    intervalMs: 1200,
    duplicateRate: 0.16,
    outOfOrderRate: 0.22,
  },
  thresholds: {
    maxErrorRate: 0.02,
    maxReadP95Ms: 900,
    maxWriteP95Ms: 1250,
    maxWebhookDrainSeconds: 120,
  },
  weights: {
    listRequests: 20,
    openRequestDetail: 15,
    readDashboard: 10,
    createRequest: 10,
    addComment: 10,
    assignRequest: 10,
    changeStatus: 15,
    completeApproval: 10,
  },
}
