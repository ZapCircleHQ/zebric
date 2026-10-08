import {
  RouteMatcher, actorFromSession, discoverLiveDependencies, resolveLiveConfig, validLiveCursor,
  type Blueprint, type RuntimePorts, type LiveSession,
} from '@zebric/runtime-core'

/** Both polling and SSE consume the same authorized reconciliation operation. */
export async function handleLive(request: Request, blueprint: Blueprint, ports: RuntimePorts): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store, no-transform', Vary: 'Cookie, Authorization' }
  const fail = (status: number) => Response.json({ error: 'Live view unavailable' }, { status, headers })
  if (request.method !== 'GET') return fail(405)
  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) return fail(400)
  const match = new RouteMatcher().match(path, blueprint.pages)
  if (!match?.page.live) return fail(404)
  const changes = ports.liveChanges ?? ports.queryExecutor?.liveChanges
  if (!changes || !ports.queryExecutor) return fail(503)
  const httpRequest = { method: 'GET', url: request.url, headers: Object.fromEntries(request.headers.entries()) }
  let identity: string | undefined
  const authorize = async (): Promise<LiveSession> => {
    const session = await ports.sessionManager?.getSession(httpRequest) ?? null
    if ((!session && match.page.auth !== 'none' && match.page.auth !== 'optional')
      || (session && new Date(session.expiresAt).getTime() <= Date.now())) throw 401
    const actor = actorFromSession(session)
    const currentIdentity = JSON.stringify([actor?.id, actor?.type, actor?.credentialId])
    if (identity !== undefined && currentIdentity !== identity) throw 401
    identity = currentIdentity
    const dependencies = discoverLiveDependencies(match.page)
    try {
      // Use the normal executor, including query filters and all read policies.
      for (const query of Object.values(match.page.queries ?? {})) {
        await ports.queryExecutor!.execute(query, { session, params: match.params, query: match.query })
      }
      for (const dependency of dependencies) {
        await ports.queryExecutor!.execute({ entity: dependency.entity, limit: 1 }, { session })
      }
    } catch (error) {
      if (String(error).includes('Access denied') || (error as { code?: string })?.code === 'AUTHORIZATION_FAILED') throw 403
      throw error
    }
    return { page: match.page.path, path, actor, dependencies, cursor: '' }
  }
  let session: LiveSession
  try { session = await authorize() } catch (error) { return fail(typeof error === 'number' ? error : 503) }
  let cursor: string
  try { cursor = request.headers.get('last-event-id') ?? url.searchParams.get('cursor') ?? await changes.currentCursor() }
  catch { return fail(503) }
  if (!validLiveCursor(cursor)) return fail(400)
  if (url.searchParams.get('transport') === 'poll') {
    try {
      const result = await changes.reconcile(session.dependencies, cursor)
      return Response.json({ type: result.changed ? 'invalidate' : 'current', cursor: result.cursor }, { headers })
    } catch { return fail(503) }
  }
  // Full re-authorization (session + every page query) runs at most this often per stream, and before any invalidation.
  const { reauthorizeIntervalMs } = resolveLiveConfig(blueprint)
  let stopped = false
  let lastAuthorized = Date.now()
  let wake: (() => void) | undefined
  let closeStream: (() => void) | undefined
  const stop = () => {
    stopped = true
    wake?.()
    request.signal.removeEventListener('abort', abort)
  }
  const abort = () => { stop(); closeStream?.() }
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      closeStream = () => { try { controller.close() } catch { /* already closed */ } }
      if (request.signal.aborted) { abort(); return }
      request.signal.addEventListener('abort', abort, { once: true })
      controller.enqueue(encoder.encode(': connected\n\n'))
    },
    async pull(controller) {
      try {
        if (stopped) return
        if (Date.now() - lastAuthorized >= reauthorizeIntervalMs) {
          session = await authorize()
          lastAuthorized = Date.now()
        }
        const result = await changes.reconcile(session.dependencies, cursor)
        if (stopped) return
        if (result.changed) {
          // Re-check access right before telling the client to refetch.
          session = await authorize()
          lastAuthorized = Date.now()
        }
        cursor = result.cursor
        controller.enqueue(encoder.encode(result.changed
          ? `id: ${cursor}\nevent: invalidate\ndata: ${JSON.stringify({ type: 'invalidate', cursor })}\n\n`
          : ': heartbeat\n\n'))
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { wake = undefined; resolve() }, 1000)
          wake = () => { clearTimeout(timer); wake = undefined; resolve() }
          if (stopped) wake()
        })
      } catch (error) {
        if (!stopped) {
          if (error === 401 || error === 403) controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'))
          else controller.error(new Error('Live connection interrupted'))
        }
        abort()
      }
    },
    cancel() { stop() },
  })
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' } })
}
