export default {
  name: 'browsing-herd',
  description: 'Read-heavy benchmark to expose query and rendering inefficiencies.',
  durationSeconds: 420,
  concurrency: 120,
  rampStages: [
    { untilSeconds: 120, concurrency: 30 },
    { untilSeconds: 240, concurrency: 60 },
    { untilSeconds: Number.POSITIVE_INFINITY, concurrency: 120 },
  ],
  webhook: {
    burstSize: 2,
    intervalMs: 8000,
    duplicateRate: 0.02,
    outOfOrderRate: 0.03,
  },
  thresholds: {
    maxErrorRate: 0.005,
    maxReadP95Ms: 600,
    maxWriteP95Ms: 1200,
    maxWebhookDrainSeconds: 120,
  },
  weights: {
    listRequests: 45,
    openRequestDetail: 25,
    readDashboard: 20,
    createRequest: 4,
    addComment: 3,
    assignRequest: 1,
    changeStatus: 1,
    completeApproval: 1,
  },
}
