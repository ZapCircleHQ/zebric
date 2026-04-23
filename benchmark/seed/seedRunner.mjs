import { buildSeedState, SEED_TIERS } from './generators.mjs'
import { bulkInsertEntity } from './bulkInsert.mjs'
import {
  ensureDir,
  openBenchmarkDatabase,
  resetSqliteFile,
} from '../lib/runtime.mjs'

function buildRelatedRows(state) {
  const { tier, requests, rng } = state
  const requestMap = new Map(requests.map((request) => [request.id, request]))
  const rows = {
    requestTags: [],
    externalReferences: [],
    comments: [],
    approvalSteps: [],
    auditEvents: [],
    notifications: [],
    webhookEvents: [],
    workflowRuns: [],
  }

  let counter = 1
  for (const request of requests) {
    const tagCount = rng.next() < 0.2 ? 0 : 1 + rng.int(4)
    for (let index = 0; index < tagCount; index += 1) {
      rows.requestTags.push({
        id: `rtag_${String(counter++).padStart(8, '0')}`,
        requestId: request.id,
        tagId: state.pickTagId(),
      })
    }
    if (rng.next() < 0.25) {
      rows.externalReferences.push({
        id: `xref_${String(counter++).padStart(8, '0')}`,
        requestId: request.id,
        provider: rng.pick(['jira', 'slack', 'github', 'salesforce']),
        externalId: `ext-${counter}`,
        url: `https://example.internal/${request.id}/${counter}`,
      })
    }
  }

  function generateMany(target, factory) {
    for (let index = 0; index < target; index += 1) {
      rows[factory.collection].push(factory.create(index))
    }
  }

  generateMany(tier.comments, {
    collection: 'comments',
    create(index) {
      const requestId = state.pickHotRequestId()
      const request = requestMap.get(requestId)
      return {
        id: `comment_${String(index + 1).padStart(8, '0')}`,
        requestId,
        authorUserId: state.pickUserId(request.teamId),
        body: `Comment ${index + 1} for ${request.title}.`,
        createdAt: state.timestamp(),
      }
    },
  })

  generateMany(tier.approvalSteps, {
    collection: 'approvalSteps',
    create(index) {
      const requestId = state.pickHotRequestId()
      const request = requestMap.get(requestId)
      return {
        id: `approval_${String(index + 1).padStart(8, '0')}`,
        requestId,
        approverUserId: state.pickUserId(request.teamId),
        stepOrder: 1 + (index % 3),
        status: rng.pickWeighted([
          { value: 'pending', weight: 40 },
          { value: 'approved', weight: 45 },
          { value: 'rejected', weight: 15 },
        ]),
        completedAt: state.timestamp(),
      }
    },
  })

  generateMany(tier.auditEvents, {
    collection: 'auditEvents',
    create(index) {
      const requestId = state.pickHotRequestId()
      const request = requestMap.get(requestId)
      return {
        id: `audit_${String(index + 1).padStart(8, '0')}`,
        requestId,
        actorUserId: state.pickUserId(request.teamId),
        eventType: rng.pick(['request.created', 'request.updated', 'comment.added', 'status.changed', 'approval.completed']),
        payload: { source: 'seed', ordinal: index + 1 },
        createdAt: state.timestamp(),
      }
    },
  })

  generateMany(tier.notifications, {
    collection: 'notifications',
    create(index) {
      const requestId = state.pickHotRequestId()
      const request = requestMap.get(requestId)
      return {
        id: `notification_${String(index + 1).padStart(8, '0')}`,
        requestId,
        recipientUserId: state.pickUserId(request.teamId),
        channel: rng.pick(['http', 'console']),
        status: rng.pickWeighted([
          { value: 'pending', weight: 5 },
          { value: 'delivered', weight: 92 },
          { value: 'failed', weight: 3 },
        ]),
        payload: { source: 'seed', type: 'reminder' },
        createdAt: state.timestamp(),
        deliveredAt: state.timestamp(),
        attempts: 1 + rng.int(3),
      }
    },
  })

  generateMany(tier.webhookEvents, {
    collection: 'webhookEvents',
    create(index) {
      const requestId = state.pickHotRequestId()
      return {
        id: `webhook_${String(index + 1).padStart(8, '0')}`,
        requestId,
        source: rng.pick(['zendesk', 'slack', 'github', 'pagerduty']),
        eventType: rng.pick(['status_update', 'comment_added', 'priority_escalated']),
        payload: { source: 'seed', ordinal: index + 1 },
        deliveryKey: `delivery-${Math.floor(index * 0.92)}`,
        receivedAt: state.timestamp(),
        processedAt: rng.next() < 0.7 ? state.timestamp() : null,
        processingStatus: rng.next() < 0.95 ? 'processed' : 'pending',
      }
    },
  })

  generateMany(tier.workflowRuns, {
    collection: 'workflowRuns',
    create(index) {
      const requestId = state.pickHotRequestId()
      return {
        id: `workflow_${String(index + 1).padStart(8, '0')}`,
        requestId,
        workflowType: rng.pick(['request_created', 'status_changed', 'approval_completed', 'webhook_received']),
        status: rng.pickWeighted([
          { value: 'pending', weight: 5 },
          { value: 'completed', weight: 92 },
          { value: 'failed', weight: 5 },
        ]),
        startedAt: state.timestamp(),
        completedAt: state.timestamp(),
        attempts: 1 + rng.int(2),
        payload: { source: 'seed', ordinal: index + 1 },
      }
    },
  })

  return rows
}

async function clearExistingData(connection) {
  const db = connection.getDb()
  const order = [
    'RequestTag',
    'ExternalReference',
    'Notification',
    'WebhookEvent',
    'WorkflowRun',
    'ApprovalStep',
    'RequestComment',
    'AuditEvent',
    'Request',
    'User',
    'Tag',
    'Team',
  ]

  for (const entityName of order) {
    const table = connection.getTable(entityName)
    try {
      await db.delete(table)
    } catch (error) {
      const message = error?.message ?? ''
      const code = error?.cause?.code ?? error?.code
      if (code === '42P01' || message.includes('does not exist')) {
        continue
      }
      throw error
    }
  }
}

export async function seedBenchmark({
  profile = 'big-zebra-v1',
  tier = 'smoke',
  seedValue = 1337,
  databaseUrl,
  outputSummary = true,
  reset = true,
} = {}) {
  if (!SEED_TIERS[tier]) {
    throw new Error(`Unknown seed tier: ${tier}`)
  }

  ensureDir(new URL('../results', import.meta.url).pathname)

  if (reset) {
    resetSqliteFile(databaseUrl)
  }

  const { connection, kind } = await openBenchmarkDatabase(databaseUrl)

  if (!reset || kind === 'postgres') {
    await clearExistingData(connection)
  }

  const state = buildSeedState(tier, Number(seedValue))
  const related = buildRelatedRows(state)

  const summary = {
    profile,
    tier,
    seedValue: Number(seedValue),
    databaseKind: kind,
    counts: {
      teams: state.teams.length,
      users: state.users.length,
      requests: state.requests.length,
      tags: state.tags.length,
      requestTags: related.requestTags.length,
      externalReferences: related.externalReferences.length,
      comments: related.comments.length,
      approvalSteps: related.approvalSteps.length,
      auditEvents: related.auditEvents.length,
      notifications: related.notifications.length,
      webhookEvents: related.webhookEvents.length,
      workflowRuns: related.workflowRuns.length,
    },
  }

  await bulkInsertEntity(connection, 'Team', state.teams)
  await bulkInsertEntity(connection, 'User', state.users)
  await bulkInsertEntity(connection, 'Tag', state.tags)
  await bulkInsertEntity(connection, 'Request', state.requests)
  await bulkInsertEntity(connection, 'RequestTag', related.requestTags)
  await bulkInsertEntity(connection, 'ExternalReference', related.externalReferences)
  await bulkInsertEntity(connection, 'RequestComment', related.comments)
  await bulkInsertEntity(connection, 'ApprovalStep', related.approvalSteps)
  await bulkInsertEntity(connection, 'AuditEvent', related.auditEvents)
  await bulkInsertEntity(connection, 'Notification', related.notifications)
  await bulkInsertEntity(connection, 'WebhookEvent', related.webhookEvents)
  await bulkInsertEntity(connection, 'WorkflowRun', related.workflowRuns)

  await connection.close()

  if (outputSummary) {
    console.log(JSON.stringify(summary, null, 2))
  }

  return summary
}
