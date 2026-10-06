import { AccessControl, actorFromSession, type Blueprint, type UserSession } from '@zebric/runtime-core'
import type { Hono } from 'hono'
import { agentHasScopes } from '../auth/api-key-auth.js'
import { D1RuntimeJournal, eventAudience } from '../audit/d1-runtime-journal.js'
import { WorkersQueryExecutor } from '../query/workers-query-executor.js'

export function registerJournalRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    journal: D1RuntimeJournal
    queries: WorkersQueryExecutor
    resolveSession: (request: Request) => Promise<UserSession | null>
  }
): void {
  app.get('/api/audit', async (c) => {
    try {
      const session = await deps.resolveSession(c.req.raw)
      if (!session) return error(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
      const entityName = c.req.query('entity')
      const recordId = c.req.query('recordId')
      const limitValue = c.req.query('limit')
      const limit = limitValue === undefined ? 50 : Number(limitValue)
      if (!entityName || !recordId || !Number.isInteger(limit) || limit < 1 || limit > 200) {
        return error(400, 'INVALID_QUERY', 'entity and recordId are required; limit must be 1-200')
      }
      const entity = deps.blueprint.entities.find((candidate) => candidate.name === entityName)
      if (!entity) return error(404, 'RESOURCE_NOT_FOUND', 'The audited record was not found')
      if (!agentHasScopes(session, [`entity.${entityName.toLowerCase()}.get`])) {
        return error(403, 'INSUFFICIENT_SCOPE', 'The credential lacks required entity scopes')
      }
      const record = await deps.queries.findById(entityName, recordId, { session })
      if (!record) return error(404, 'RESOURCE_NOT_FOUND', 'The audited record was not found')
      const fields = new Set(AccessControl.getAccessibleFields(entity, 'read', session, record))
      const entries = await deps.journal.queryAudit({
        entity: entityName,
        recordId,
        command: c.req.query('command'),
        workflow: c.req.query('workflow'),
        actorId: c.req.query('actorId'),
        limit
      })
      return Response.json(
        entries.map((entry) => ({
          ...entry,
          metadata: entry.metadata && {
            ...entry.metadata,
            ...(entry.metadata.mutation && typeof entry.metadata.mutation === 'object'
              ? {
                  mutation: Object.fromEntries(
                    Object.entries(entry.metadata.mutation).filter(([field]) => fields.has(field))
                  )
                }
              : {})
          }
        })),
        { headers: { 'Cache-Control': 'no-store', Vary: 'Authorization, Cookie' } }
      )
    } catch (cause) {
      if (String(cause).includes('Access denied') || (cause as { code?: string })?.code === 'AUTHORIZATION_FAILED') {
        return error(403, 'AUTHORIZATION_FAILED', 'Audit history access denied')
      }
      return error(500, 'INTERNAL_ERROR', 'Audit history query failed')
    }
  })

  app.get('/api/agent/events', async (c) => {
    const request = c.req.raw
    const session = await deps.resolveSession(request)
    const actor = actorFromSession(session)
    if (!session || !actor) return error(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
    const audience = eventAudience(actor)
    const lastId = request.headers.get('last-event-id')
    if (lastId !== null && (!/^\d+$/.test(lastId) || !Number.isSafeInteger(Number(lastId)))) {
      return error(400, 'INVALID_QUERY', 'Last-Event-ID must be a nonnegative integer')
    }
    let cursor = lastId === null ? await deps.journal.latestSequence() : Number(lastId)
    let stopped = false
    let stopWaiting: (() => void) | undefined
    let heartbeatAt = Date.now()
    const encoder = new TextEncoder()
    const stop = () => {
      stopped = true
      stopWaiting?.()
    }
    const wait = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          stopWaiting = undefined
          resolve()
        }, 1000)
        stopWaiting = () => {
          clearTimeout(timer)
          stopWaiting = undefined
          resolve()
        }
      })
    let closeStream = () => {}
    const onAbort = () => {
      stop()
      closeStream()
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        closeStream = () => {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
        if (request.signal.aborted) {
          stop()
          closeStream()
          return
        }
        request.signal.addEventListener('abort', onAbort, { once: true })
        controller.enqueue(encoder.encode(': connected\n\n'))
      },
      async pull(controller) {
        try {
          while (!stopped) {
            // Recheck session expiry and record authorization throughout a live stream.
            const currentSession = await deps.resolveSession(request)
            const currentActor = actorFromSession(currentSession)
            if (!currentSession || !currentActor || eventAudience(currentActor) !== audience) {
              stop()
              closeStream()
              break
            }
            const events = await deps.journal.queryEvents(audience, cursor)
            for (const event of events) {
              cursor = Number(event.id)
              const entity = String(event.data.entity)
              if (!agentHasScopes(currentSession, [`entity.${entity.toLowerCase()}.get`])) continue
              const record = await deps.queries
                .findById(entity, String(event.data.recordId), { session: currentSession })
                .catch(() => null)
              if (!record || stopped) continue
              controller.enqueue(
                encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
              )
            }
            if (events.length) return
            if (Date.now() - heartbeatAt >= 15000) {
              heartbeatAt = Date.now()
              if (!stopped) controller.enqueue(encoder.encode(': heartbeat\n\n'))
              return
            }
            await wait()
          }
        } catch {
          stop()
          closeStream()
        } finally {
          if (stopped) request.signal.removeEventListener('abort', onAbort)
        }
      },
      cancel() {
        stop()
        request.signal.removeEventListener('abort', onAbort)
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Vary: 'Authorization, Cookie'
      }
    })
  })
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}
