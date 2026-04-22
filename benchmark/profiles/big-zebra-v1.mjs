export default {
  name: 'big-zebra-v1',
  description: 'Balanced default benchmark with mixed reads, writes, webhooks, workflows, and notifications.',
  durationSeconds: 600,
  concurrency: 150,
  rampStages: [
    { untilSeconds: 120, concurrency: 25 },
    { untilSeconds: 300, concurrency: 50 },
    { untilSeconds: 600, concurrency: 100 },
    { untilSeconds: Number.POSITIVE_INFINITY, concurrency: 150 },
  ],
  webhook: {
    burstSize: 8,
    intervalMs: 2500,
    duplicateRate: 0.08,
    outOfOrderRate: 0.12,
  },
  thresholds: {
    maxErrorRate: 0.01,
    maxReadP95Ms: 750,
    maxWriteP95Ms: 1000,
    maxWebhookDrainSeconds: 120,
  },
  weights: {
    listRequests: 35,
    openRequestDetail: 20,
    readDashboard: 10,
    createRequest: 10,
    addComment: 10,
    assignRequest: 5,
    changeStatus: 5,
    completeApproval: 5,
  },
}
