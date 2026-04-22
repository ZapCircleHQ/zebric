import { sleep } from '../lib/runtime.mjs'

export function createWebhookProducer(context) {
  const config = context.profile.webhook
  const requestHeaders = context.requestHeaders ?? {}

  async function postJson(path, body) {
    return fetch(`${context.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  return {
    async start(isRunning) {
      while (isRunning()) {
        const burst = []
        for (let index = 0; index < config.burstSize; index += 1) {
          const requestId = context.catalog.requestIds[Math.floor(Math.random() * context.catalog.requestIds.length)]
          const deliveryKey = `run-${context.runId}-delivery-${Date.now()}-${index}`
          burst.push({
            requestId,
            source: ['zendesk', 'github', 'pagerduty'][index % 3],
            eventType: ['status_update', 'priority_escalated', 'comment_added'][index % 3],
            payload: { ordinal: index, runId: context.runId },
            deliveryKey,
          })
          if (Math.random() < config.duplicateRate) {
            burst.push({
              requestId,
              source: 'zendesk',
              eventType: 'status_update',
              payload: { ordinal: index, duplicate: true, runId: context.runId },
              deliveryKey,
            })
          }
        }

        if (Math.random() < config.outOfOrderRate) {
          burst.reverse()
        }

        await Promise.allSettled(
          burst.map(async (payload) => {
            const startedAt = performance.now()
            try {
              const response = await postJson('/api/webhookevents', {
                requestId: payload.requestId,
                source: payload.source,
                eventType: payload.eventType,
                payload: payload.payload,
                deliveryKey: payload.deliveryKey,
                processingStatus: 'pending',
              })
              if (response.ok) {
                await postJson('/api/workflowruns', {
                  requestId: payload.requestId,
                  workflowType: 'webhook_received',
                  status: 'pending',
                  payload: {
                    ...payload.payload,
                    deliveryKey: payload.deliveryKey,
                    source: payload.source,
                    eventType: payload.eventType,
                  },
                }).catch(() => {})
              }
              context.metrics.record(
                'receiveWebhook',
                performance.now() - startedAt,
                response.ok,
                response.ok ? undefined : await response.text()
              )
            } catch (error) {
              context.metrics.record(
                'receiveWebhook',
                performance.now() - startedAt,
                false,
                error instanceof Error ? error.message : String(error)
              )
            }
          })
        )

        await sleep(config.intervalMs)
      }
    },
  }
}
