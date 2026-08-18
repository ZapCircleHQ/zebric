import type { Hono } from 'hono'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import type { NotificationManager } from '@zebric/notifications'
import type { AuthProvider, SessionManager, UserSession } from '@zebric/runtime-core'
import type { ActionBarAction, Blueprint } from '@zebric/runtime-core'
import { PermissionManager, evaluateCondition, generateOpenAPISpec, getInjectedCsrfTokenFromRequest } from '@zebric/runtime-core'
import type { EngineConfig } from '../types/index.js'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { AuditEventType, AuditSeverity, type AuditLogger } from '../security/index.js'
import {
  registerWidgetRoutes as registerSharedWidgetRoutes,
  registerSearchRoutes as registerSharedSearchRoutes,
} from '@zebric/runtime-hono'
import { agentApiError } from './agent-api-error.js'
import {
  getMimeType,
  resolveOrigin,
  getCallbackPath,
  tryParseBody,
  isUrlVerificationRequest,
  parseActionRequestBody,
  parseActionPayload,
  resolveActionRedirect,
  setFlashMessage,
  acceptsJson,
} from './server-utils.js'
import { agentHasScopes, resolveAgentAttribution, resolveApiKeySession } from './server-security.js'
import {
  handleSkillEntityAction,
  handleSkillWorkflow,
  triggerEntityWorkflows,
  isStandardCrudRoute,
} from './server-action-handlers.js'

function getCorrelationId(c: any): string | undefined {
  return (c as any).get('correlationId') as string | undefined
    ?? c.req.header('x-correlation-id')
    ?? undefined
}

function sessionSecurityId(session: UserSession | null | undefined): string | undefined {
  if (session?.actor?.type === 'agent') return session.actor.credentialId
  return session?.user?.id
}

function entityScope(entity: string, action: string): string {
  return `entity.${entity.toLowerCase()}.${action}`
}

function getRequestId(c: any): string | undefined {
  return (c as any).get('requestId') as string | undefined
    ?? undefined
}

function logRouteStageTiming(
  route: string,
  stageMs: Record<string, number>,
  details: Record<string, unknown> = {}
): void {
  if (process.env.ZEBRIC_TIMING_DEBUG !== '1') {
    return
  }

  console.log(JSON.stringify({
    type: 'route_stage_timing',
    route,
    ...details,
    ...Object.fromEntries(
      Object.entries(stageMs).map(([key, value]) => [key, Number(value.toFixed(3))])
    ),
  }))
}

function getPagePrimaryEntity(page: Blueprint['pages'][number] | undefined): string | undefined {
  if (!page) {
    return undefined
  }

  const boardQuery = page.board?.query ? page.queries?.[page.board.query] : undefined
  if (boardQuery?.entity) {
    return boardQuery.entity
  }

  if (page.form?.entity) {
    return page.form.entity
  }

  const firstQuery = page.queries ? Object.values(page.queries)[0] : undefined
  return firstQuery?.entity
}

function findPage(blueprint: Blueprint | undefined, pagePath: unknown): Blueprint['pages'][number] | undefined {
  if (!blueprint || typeof pagePath !== 'string') {
    return undefined
  }
  return blueprint.pages?.find((candidate) => candidate.path === pagePath)
}

function getPageActionBarActions(page: Blueprint['pages'][number] | undefined): ActionBarAction[] {
  return [
    ...(page?.actionBar?.actions ?? []),
    ...(page?.actionBar?.secondaryActions ?? []),
  ]
}

// Resolves which page/workflow-name pair the client claims to be acting from. The
// caller is responsible for verifying the record against `entity` and for checking
// permissions against `entity` (server-resolved), never against client-supplied input.
function pageExposesWorkflow(
  blueprint: Blueprint | undefined,
  workflowName: string,
  pagePath: unknown
): boolean {
  const workflow = blueprint?.workflows?.find((candidate) => candidate.name === workflowName)
  if (!workflow?.trigger?.manual) {
    return false
  }

  const page = findPage(blueprint, pagePath)
  if (!page) {
    return false
  }

  if (getPageActionBarActions(page).some((action) => action.workflow === workflowName)) {
    return true
  }

  return page.board?.move?.workflow === workflowName
}

function findPageWorkflowActions(
  blueprint: Blueprint | undefined,
  workflowName: string,
  pagePath: unknown
): ActionBarAction[] {
  const page = findPage(blueprint, pagePath)
  if (!page?.actionBar) {
    return []
  }

  return getPageActionBarActions(page).filter((action) => action.workflow === workflowName)
}

// True if ANY action-bar entry anywhere in the blueprint gates this workflow behind
// visibleWhen/enabledWhen. Used to fail closed when the client doesn't supply a `page`
// we can resolve the specific action from - otherwise the gating below is a no-op for
// any caller that simply omits `page`.
function workflowHasGatedAction(blueprint: Blueprint | undefined, workflowName: string): boolean {
  if (!blueprint) {
    return false
  }
  return (blueprint.pages ?? []).some((page) =>
    getPageActionBarActions(page).some(
      (action) => action.workflow === workflowName && (action.visibleWhen || action.enabledWhen)
    )
  )
}

interface RequiredEntityAction {
  entity: string
  action: 'create' | 'read' | 'update' | 'delete'
}

// Manual-trigger workflows carry no verb of their own, and a workflow's steps often
// touch several different entities (e.g. approving an application also updates the
// dog, creates a task, an email, and an activity record). Deriving the exact
// (entity, action) pairs a workflow writes - instead of assuming one hardcoded verb,
// or checking every action against a single entity - lets the caller be checked
// against every write the workflow will actually attempt before step 1 ever runs.
// Without this upfront check, a session permitted to perform only the workflow's
// first step can trigger it, have that first (permitted) write commit, and then have
// a later step fail on write N - leaving partially-applied, inconsistent data instead
// of a clean rejection.
function getWorkflowRequiredEntityActions(
  workflow: { steps?: Array<Record<string, any>> } | undefined
): RequiredEntityAction[] {
  const seen = new Set<string>()
  const pairs: RequiredEntityAction[] = []

  const visit = (steps: Array<Record<string, any>> | undefined) => {
    for (const step of steps ?? []) {
      if (step.type === 'query' && step.entity && step.action) {
        const action = step.action === 'find' ? 'read' : step.action
        const key = `${step.entity}.${action}`
        if (!seen.has(key)) {
          seen.add(key)
          pairs.push({ entity: step.entity, action })
        }
      }
      visit(step.then)
      visit(step.else)
      visit(step.do)
    }
  }
  visit(workflow?.steps)

  return pairs
}

// Checks the caller against every (entity, action) pair a workflow's steps will
// attempt, so an under-privileged caller is rejected before step 1 runs rather than
// after some prefix of steps has already committed. `fallback` is only used for
// workflows with no derivable query steps (e.g. purely a webhook/email step); when
// there's nothing entity-related to check and no fallback was supplied, this allows
// the call through rather than inventing a new restriction with no factual basis.
async function checkWorkflowEntityPermissions(
  permissionManager: PermissionManager,
  session: UserSession | null,
  workflow: { steps?: Array<Record<string, any>> } | undefined,
  fallback?: RequiredEntityAction
): Promise<boolean> {
  const pairs = getWorkflowRequiredEntityActions(workflow)
  const checks = pairs.length > 0 ? pairs : fallback ? [fallback] : []
  if (checks.length === 0) {
    return true
  }

  const results = await Promise.all(
    checks.map((pair) => permissionManager.checkPermission({ session, entity: pair.entity, action: pair.action }))
  )
  return results.every(Boolean)
}

export function registerStaticUploads(app: Hono): void {
  const root = path.resolve(process.cwd(), 'data/uploads')
  app.get('/uploads/*', async (c) => {
    const relative = c.req.path.replace(/^\/uploads\/?/, '')
    const filePath = path.resolve(root, relative)
    // Prevent path traversal outside the uploads directory
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      return Response.json({ error: 'File not found' }, { status: 404 })
    }
    try {
      const data = await fs.readFile(filePath)
      const mimeType = getMimeType(filePath)
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mimeType }
      })
    } catch {
      return Response.json({ error: 'File not found' }, { status: 404 })
    }
  })
}

export function registerAuthPages(app: Hono, blueprint: Blueprint, config: EngineConfig): void {
  app.get('/auth/sign-in', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const renderer = await createAuthRenderer(blueprint, config)
    const csrfToken = getInjectedCsrfTokenFromRequest(c.req.raw)
    return c.html(renderer.renderSignInPage(callback, undefined, csrfToken))
  })

  app.get('/auth/sign-up', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const renderer = await createAuthRenderer(blueprint, config)
    const csrfToken = getInjectedCsrfTokenFromRequest(c.req.raw)
    return c.html(renderer.renderSignUpPage(callback, undefined, csrfToken))
  })

  app.get('/auth/sign-out', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const renderer = await createAuthRenderer(blueprint, config)
    const csrfToken = getInjectedCsrfTokenFromRequest(c.req.raw)
    return c.html(renderer.renderSignOutPage(callback, csrfToken))
  })
}

async function createAuthRenderer(blueprint: Blueprint, config: EngineConfig) {
  const rendererModule = await import('../renderer/index.js')
  if (config.rendererClass) {
    return new config.rendererClass(blueprint, config.theme)
  }
  const templateLoader = new rendererModule.FileTemplateLoader({
    baseDir: path.dirname(config.blueprintPath),
    cache: !config.dev?.hotReload,
  })
  return new rendererModule.HTMLRenderer(blueprint, config.theme, undefined, templateLoader)
}

export function registerAuthRoutes(app: Hono, authProvider: AuthProvider): void {
  app.all('/api/auth/*', async (c) => {
    try {
      const betterAuthInstance = authProvider.getAuthInstance()
      const response = await betterAuthInstance.handler(c.req.raw)
      return response
    } catch (error) {
      console.error('Auth route error:', error)
      return Response.json(
        {
          error: 'Authentication failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export function registerWebhookRoutes(app: Hono, workflowManager?: WorkflowManager): void {
  if (!workflowManager) {
    return
  }

  app.all('/webhooks/*', async (c) => {
    try {
      const webhookPath = new URL(c.req.url).pathname
      const jobs = await workflowManager.triggerWebhook(webhookPath, {
        headers: Object.fromEntries(c.req.raw.headers),
        body: await tryParseBody(c.req.raw),
        query: Object.fromEntries(new URL(c.req.url).searchParams),
        correlationId: getCorrelationId(c),
        requestId: getRequestId(c),
      })

      if (jobs.length === 0) {
        return Response.json(
          { error: 'No workflow found for this webhook', path: webhookPath },
          { status: 404 }
        )
      }

      return Response.json({
        success: true,
        message: `Triggered ${jobs.length} workflow(s)`,
        jobs: jobs.map((job) => ({
          id: job.id,
          workflow: job.workflowName,
          status: job.status
        }))
      })
    } catch (error) {
      console.error('Webhook error:', error)
      return Response.json(
        {
          error: 'Failed to trigger workflow',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export function registerNotificationRoutes(
  app: Hono,
  notificationManager?: NotificationManager,
  workflowManager?: WorkflowManager
): void {
  app.all('/notifications/:adapterName/inbound', async (c) => {
    if (!notificationManager) {
      return Response.json({ error: 'Notification service not configured' }, { status: 404 })
    }

    const adapterName = c.req.param('adapterName')
    if (!adapterName) {
      return Response.json({ error: 'Notification adapter is required' }, { status: 400 })
    }

    const requestUrl = new URL(c.req.url)
    const inboundPath = requestUrl.pathname
    const requestData = {
      headers: Object.fromEntries(c.req.raw.headers),
      body: await tryParseBody(c.req.raw.clone()),
      query: Object.fromEntries(requestUrl.searchParams),
      correlationId: getCorrelationId(c),
      requestId: getRequestId(c),
    }

    const response = await notificationManager.handleRequest(adapterName, c.req.raw)

    if (response.ok && workflowManager && !isUrlVerificationRequest(requestData.body)) {
      try {
        await workflowManager.triggerWebhook(inboundPath, requestData)
      } catch (error) {
        console.error(`Failed to trigger workflows for notification inbound path ${inboundPath}:`, error)
      }
    }

    return response
  })
}

export function registerActionRoutes(
  app: Hono,
  deps: {
    blueprint?: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
  }
): void {
  if (!deps.workflowManager) {
    return
  }

  const { blueprint, sessionManager, queryExecutor, workflowManager } = deps
  const anonymousActionRule = blueprint?.auth?.permissions?.anonymous ?? blueprint?.auth?.permissions?.public
  const permissionManager = blueprint ? new PermissionManager(blueprint.auth) : undefined

  app.post('/actions/:workflowName', async (c) => {
    const workflowName = c.req.param('workflowName')
    if (!workflowName) {
      return Response.json({ error: 'Workflow name is required' }, { status: 400 })
    }

    let body: Record<string, any> = {}

    try {
      body = await parseActionRequestBody(c)

      const payload = parseActionPayload(body.payload)
      const entity = typeof body.entity === 'string' ? body.entity : undefined
      const recordId = typeof body.recordId === 'string' ? body.recordId : undefined
      const successMessage = typeof body.successMessage === 'string' ? body.successMessage : undefined
      const session = await sessionManager.getSession(c.req.raw)
      const workflow = workflowManager!.getWorkflow(workflowName)
      if (!session) {
        const exposed = pageExposesWorkflow(blueprint, workflowName, body.page)
        const resolvedEntity = exposed ? getPagePrimaryEntity(findPage(blueprint, body.page)) : undefined
        const entityMatches = !entity || entity === resolvedEntity
        const allowed = exposed && resolvedEntity && entityMatches && anonymousActionRule && permissionManager
          ? await checkWorkflowEntityPermissions(permissionManager, null, workflow, { entity: resolvedEntity, action: 'update' })
          : false
        if (!allowed) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
      } else if (permissionManager) {
        // Verified upfront, not just per-step during execution: a caller permitted to
        // perform only part of a workflow must never be able to trigger it at all, or
        // that permitted prefix of steps commits before the workflow fails downstream.
        const allowed = await checkWorkflowEntityPermissions(permissionManager, session, workflow)
        if (!allowed) {
          return Response.json({ error: 'Insufficient permissions for this workflow' }, { status: 403 })
        }
      }
      let record: any = null

      if (entity && recordId) {
        try {
          record = await queryExecutor.findById(entity, recordId, { session })
        } catch (error) {
          console.warn(`Action workflow '${workflowName}' could not load ${entity}(${recordId})`, error)
        }
      }

      if (!workflow) {
        return Response.json(
          { error: `Workflow '${workflowName}' not found` },
          { status: 404 }
        )
      }

      const pageActions = findPageWorkflowActions(blueprint, workflowName, body.page)
      if (pageActions.length > 0) {
        const permitted = pageActions.some(
          (action) => evaluateCondition(action.visibleWhen, record) && evaluateCondition(action.enabledWhen, record)
        )
        if (!permitted) {
          return Response.json(
            { error: 'Action is not available for this record' },
            { status: 409 }
          )
        }
      } else if (workflowHasGatedAction(blueprint, workflowName)) {
        // The workflow is gated by visibleWhen/enabledWhen somewhere in the blueprint,
        // but the caller didn't supply a `page` we can resolve the specific action from -
        // fail closed rather than silently skipping the check.
        return Response.json(
          { error: 'Action is not available for this record' },
          { status: 409 }
        )
      }

      const actionData = {
        payload,
        entity,
        recordId,
        record,
        page: body.page,
        redirect: body.redirect,
        session,
      }

      if (workflow.precondition) {
        // Mirrors the context WorkflowManager.trigger() builds internally (trigger.data /
        // variables.data / session only) - WorkflowQueue.enqueue evaluates the same
        // precondition again against that context, so the two must stay in lockstep or a
        // precondition that passes here could still throw there.
        const preconditionContext: Record<string, any> = {
          trigger: { type: 'manual', data: actionData },
          variables: { data: actionData },
        }
        if (session) {
          preconditionContext.session = session
        }
        if (!evaluateCondition(workflow.precondition, preconditionContext)) {
          return Response.json(
            { error: 'Workflow precondition failed' },
            { status: 409 }
          )
        }
      }

      const job = workflowManager!.trigger(workflowName, actionData, {
        correlationId: getCorrelationId(c),
        requestId: getRequestId(c),
      })

      const redirectTarget = resolveActionRedirect(
        typeof body.redirect === 'string' ? body.redirect : undefined,
        c.req.header('referer')
      )
      const message = successMessage || `Workflow "${workflowName}" started.`
      setFlashMessage(c, message, 'success')

      if (acceptsJson(c)) {
        return Response.json({
          success: true,
          job: { id: job.id, workflow: workflowName },
          message,
          redirect: redirectTarget
        })
      }

      return c.redirect(redirectTarget, 303)
    } catch (error) {
      console.error('Action route error:', error)
      const fallbackRedirect = resolveActionRedirect(
        typeof body.redirect === 'string' ? body.redirect : undefined,
        c.req.header('referer')
      )
      const errorMsg = (body && typeof body.errorMessage === 'string')
        ? body.errorMessage
        : 'Failed to trigger action'
      setFlashMessage(c, errorMsg, 'error')

      if (acceptsJson(c)) {
        return Response.json(
          {
            error: 'Failed to trigger action',
            details: error instanceof Error ? error.message : 'Unknown error',
            message: errorMsg,
            redirect: fallbackRedirect
          },
          { status: 500 }
        )
      }

      return c.redirect(fallbackRedirect, 303)
    }
  })
}

export function registerSkillRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
    apiKeys: ReadonlyMap<string, { name: string }>
    auditLogger?: AuditLogger
  }
): void {
  const { blueprint, sessionManager, queryExecutor, workflowManager, apiKeys, auditLogger } = deps

  if (!blueprint.skills || blueprint.skills.length === 0) {
    return
  }

  const entityNames = new Set(blueprint.entities.map(e => e.name.toLowerCase()))
  const idempotency = new Map<string, { fingerprint: string; response: Promise<Response> }>()

  for (const skill of blueprint.skills) {
    for (const action of skill.actions) {
      // Skip actions that map directly to standard CRUD routes
      if (isStandardCrudRoute(action, entityNames)) {
        continue
      }

      // Only register actions with entity+action or workflow annotations
      if (!action.entity && !action.workflow) {
        continue
      }

      // Convert {id} path syntax to Hono :id syntax
      const honoPath = action.path.replace(/\{(\w+)\}/g, ':$1')
      const method = action.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'

      app[method](honoPath, async (c) => {
        let session: UserSession | null = null
        let attribution: ReturnType<typeof resolveAgentAttribution>
        try {
          // Auth check — try API key first, then session
          const authHeader = c.req.header('authorization') || ''
          if (authHeader.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.slice(7)
            session = resolveApiKeySession(token, apiKeys)
          }
          if (!session) {
            session = await sessionManager.getSession(c.req.raw)
          }
          if (skill.auth !== 'none' && !session) {
            return agentApiError(c, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')
          }
          if (!agentHasScopes(session, action.scopes ?? [])) {
            auditLogger?.logAccessDenied(action.path, `${skill.name}.${action.name}`, session?.actor?.id ?? session?.user?.id, {
              actorType: session?.actor?.type,
              actorId: session?.actor?.id,
              agentId: session?.actor?.type === 'agent' ? session.actor.id : undefined,
              credentialId: session?.actor?.credentialId,
              requestId: getRequestId(c),
              correlationId: getCorrelationId(c),
              actionName: `${skill.name}.${action.name}`,
              metadata: { requiredScopes: action.scopes },
            })
            return agentApiError(c, 403, 'INSUFFICIENT_SCOPE', 'The credential lacks required scopes', {
              details: { requiredScopes: action.scopes ?? [] },
            })
          }
          attribution = method !== 'get' ? resolveAgentAttribution(c, session) : undefined

          const actionDeps = { queryExecutor, workflowManager }

          const executeAction = async (): Promise<Response> => {
            const response = action.workflow
              ? await handleSkillWorkflow(c, action, session, actionDeps)
              : await handleSkillEntityAction(c, action, session, actionDeps)
            auditLogger?.log({
              eventType: AuditEventType.AGENT_ACTION,
              severity: response.ok ? AuditSeverity.INFO : AuditSeverity.WARNING,
              action: `${skill.name}.${action.name}`,
              actionName: `${skill.name}.${action.name}`,
              resource: action.path,
              entityType: action.entity,
              entityId: c.req.param('id'),
              success: response.ok,
              userId: session?.user?.id,
              sessionId: session?.id,
              actorType: session?.actor?.type,
              actorId: session?.actor?.id ?? session?.user?.id,
              agentId: attribution?.agentId,
              credentialId: attribution?.credentialId ?? session?.actor?.credentialId,
              runId: attribution?.runId,
              requestId: getRequestId(c),
              correlationId: getCorrelationId(c),
              metadata: {
                skill: skill.name,
                method: action.method,
                workflow: action.workflow,
                status: response.status,
              },
            })
            return response
          }

          const idempotencyKey = c.req.header('idempotency-key')
          if (method === 'get' || !idempotencyKey) return await executeAction()

          const requestBody = await c.req.raw.clone().text()
          const requestUrl = new URL(c.req.url)
          const requestTarget = `${requestUrl.pathname}${requestUrl.search}`
          const fingerprint = createHash('sha256')
            .update(`${action.method}\n${requestTarget}\n${requestBody}`)
            .digest('hex')
          const scope = `${sessionSecurityId(session) || 'anonymous'}:${idempotencyKey}`
          const existing = idempotency.get(scope)
          if (existing) {
            if (existing.fingerprint !== fingerprint) {
              return agentApiError(c, 409, 'IDEMPOTENCY_KEY_REUSE', 'The idempotency key was reused with different request input')
            }
            return (await existing.response).clone()
          }

          const response = executeAction()
          idempotency.set(scope, { fingerprint, response })
          return (await response).clone()
        } catch (error) {
          console.error(`Skill route error (${skill.name}/${action.name}):`, error)
          const message = error instanceof Error ? error.message : 'Unknown error'
          const status = message.startsWith('Invalid agent attribution:')
            ? 400
            : message.includes('precondition failed') || message.startsWith('Conflict:') ? 409 : 500
          auditLogger?.log({
            eventType: AuditEventType.AGENT_ACTION,
            severity: AuditSeverity.WARNING,
            action: `${skill.name}.${action.name}`,
            actionName: `${skill.name}.${action.name}`,
            resource: action.path,
            entityType: action.entity,
            entityId: c.req.param('id'),
            success: false,
            errorMessage: 'Skill action failed',
            userId: session?.user?.id,
            sessionId: session?.id,
            actorType: session?.actor?.type,
            actorId: session?.actor?.id ?? session?.user?.id,
            agentId: attribution?.agentId,
            credentialId: attribution?.credentialId ?? session?.actor?.credentialId,
            runId: attribution?.runId,
            requestId: getRequestId(c),
            correlationId: getCorrelationId(c),
            metadata: { skill: skill.name, method: action.method, workflow: action.workflow, status },
          })
          if (status === 400) {
            return agentApiError(c, 400, 'INVALID_AGENT_ATTRIBUTION', 'Valid agent run attribution is required')
          }
          if (status === 409 && message.includes('precondition failed')) {
            return agentApiError(c, 409, 'WORKFLOW_PRECONDITION_FAILED', 'The workflow precondition was not satisfied')
          }
          if (status === 409) {
            return agentApiError(c, 409, 'STATE_CONFLICT', 'The requested state transition conflicts with current state')
          }
          return agentApiError(c, 500, 'INTERNAL_ERROR', 'The Agent API action failed', { retryable: true })
        }
      })
    }
  }
}

export function registerWorkflowJobRoutes(
  app: Hono,
  deps: {
    sessionManager: SessionManager
    workflowManager?: WorkflowManager
    apiKeys: ReadonlyMap<string, { name: string }>
  }
): void {
  const { sessionManager, workflowManager, apiKeys } = deps
  if (!workflowManager) return
  app.get('/api/jobs/:id', async (c) => {
    const authHeader = c.req.header('authorization') || ''
    let session = null
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      session = resolveApiKeySession(authHeader.slice(7), apiKeys)
    }
    if (!session) session = await sessionManager.getSession(c.req.raw)
    if (!session) return agentApiError(c, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required')

    const job = workflowManager.getJob(c.req.param('id'))
    const ownerId = sessionSecurityId(job?.context.session)
    if (!job || !ownerId || ownerId !== sessionSecurityId(session)) {
      return agentApiError(c, 404, 'JOB_NOT_FOUND', 'The workflow job was not found')
    }
    return Response.json({
      id: job.id,
      workflow: job.workflowName,
      status: job.status === 'completed' ? 'succeeded' : job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.status === 'failed' ? 'Workflow execution failed' : null,
    })
  })
}

export function registerAPIRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
    apiKeys: ReadonlyMap<string, { name: string }>
  }
): void {
  const { blueprint, sessionManager, queryExecutor, workflowManager, apiKeys } = deps

  if (!blueprint.entities || blueprint.entities.length === 0) {
    return
  }

  for (const entity of blueprint.entities) {
    const entityPath = `/api/${entity.name.toLowerCase()}s`
    const entityPathWithId = `${entityPath}/:id`

    app.post(entityPath, async (c) => {
      try {
        const data = await c.req.json<Record<string, any>>()
        const session = await resolveEntityApiSession(c, sessionManager, apiKeys)
        if (!agentHasScopes(session, [entityScope(entity.name, 'create')])) throw new Error('Access denied: insufficient agent scope')
        const attribution = resolveAgentAttribution(c, session)
        const createStartedAt = performance.now()
        const result = await queryExecutor.create(entity.name, data, { session })
        const createMs = performance.now() - createStartedAt

        const triggerStartedAt = performance.now()
        await triggerEntityWorkflows(entity.name, 'create', undefined, result, workflowManager, {
          correlationId: getCorrelationId(c),
          requestId: getRequestId(c),
          session,
          attribution,
        })
        const triggerMs = performance.now() - triggerStartedAt

        logRouteStageTiming(entityPath, {
          createMs,
          triggerMs,
        }, {
          entity: entity.name,
          correlationId: getCorrelationId(c),
          requestId: getRequestId(c),
        })

        return Response.json(result, { status: 201 })
      } catch (error) {
        console.error(`Create ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Create failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: entityApiErrorStatus(error) }
        )
      }
    })

    app.get(entityPath, async (c) => {
      try {
        const session = await resolveEntityApiSession(c, sessionManager, apiKeys)
        if (!agentHasScopes(session, [entityScope(entity.name, 'list')])) throw new Error('Access denied: insufficient agent scope')
        const limitParam = parseInt(c.req.query('limit') || '', 10)
        const offsetParam = parseInt(c.req.query('offset') || '', 10)
        const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, 1000)
        const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
        const results = await queryExecutor.execute(
          {
            entity: entity.name,
            orderBy: { createdAt: 'desc' },
            limit,
            offset,
          },
          { session }
        )
        return Response.json(results)
      } catch (error) {
        console.error(`List ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'List failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: entityApiErrorStatus(error) }
        )
      }
    })

    app.get(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const session = await resolveEntityApiSession(c, sessionManager, apiKeys)
        if (!agentHasScopes(session, [entityScope(entity.name, 'get')])) throw new Error('Access denied: insufficient agent scope')
        const result = await queryExecutor.findById(entity.name, id, { session })
        if (!result) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json(result)
      } catch (error) {
        console.error(`Find ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Find failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: entityApiErrorStatus(error) }
        )
      }
    })

    app.put(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const data = await c.req.json<Record<string, any>>()
        const session = await resolveEntityApiSession(c, sessionManager, apiKeys)
        if (!agentHasScopes(session, [entityScope(entity.name, 'update')])) throw new Error('Access denied: insufficient agent scope')
        const attribution = resolveAgentAttribution(c, session)
        const before = workflowManager
          ? await queryExecutor.findById(entity.name, id, { session }).catch(() => null)
          : null
        const result = await queryExecutor.update(entity.name, id, data, { session })
        await triggerEntityWorkflows(entity.name, 'update', before, result, workflowManager, {
          correlationId: getCorrelationId(c),
          requestId: getRequestId(c),
          session,
          attribution,
        })
        return Response.json(result)
      } catch (error) {
        console.error(`Update ${entity.name} error:`, error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        const statusCode = entityApiErrorStatus(error)
        return Response.json(
          {
            error: 'Update failed',
            details: errorMessage
          },
          { status: statusCode }
        )
      }
    })

    app.delete(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const session = await resolveEntityApiSession(c, sessionManager, apiKeys)
        if (!agentHasScopes(session, [entityScope(entity.name, 'delete')])) throw new Error('Access denied: insufficient agent scope')
        const attribution = resolveAgentAttribution(c, session)
        const existing = workflowManager
          ? await queryExecutor.findById(entity.name, id, { session }).catch(() => null)
          : null
        await queryExecutor.delete(entity.name, id, { session })
        await triggerEntityWorkflows(entity.name, 'delete', existing || { id }, undefined, workflowManager, {
          correlationId: getCorrelationId(c),
          requestId: getRequestId(c),
          session,
          attribution,
        })
        return Response.json({ success: true })
      } catch (error) {
        console.error(`Delete ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Delete failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: entityApiErrorStatus(error) }
        )
      }
    })
  }
}

async function resolveEntityApiSession(
  c: any,
  sessionManager: SessionManager,
  apiKeys: ReadonlyMap<string, { name: string }>
) {
  const authHeader = c.req.header('authorization') || ''
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const apiKeySession = resolveApiKeySession(authHeader.slice(7), apiKeys)
    if (apiKeySession) return apiKeySession
  }
  return sessionManager.getSession(c.req.raw)
}

function entityApiErrorStatus(error: unknown): 400 | 403 | 404 | 500 {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Invalid agent attribution:')) return 400
  if (message.includes('Access denied')) return 403
  if (message.toLowerCase().includes('not found')) return 404
  return 500
}

export function registerOpenAPIRoute(app: Hono, blueprint: Blueprint, config: EngineConfig): void {
  app.get('/.well-known/zebric-agent.json', async (c) => {
    const origin = resolveOrigin(c.req.raw, config)
    const contract = agentContractMetadata(blueprint)
    return Response.json({
      name: blueprint.project.name,
      version: blueprint.project.version,
      openapi: `${origin}/api/openapi.json`,
      contract,
      authentication: blueprint.auth?.apiKeys?.length ? [{ type: 'bearer' }] : [],
      skills: blueprint.skills?.map(skill => skill.name) ?? [],
      capabilities: {
        workflowJobs: Boolean(blueprint.workflows?.length),
        idempotency: true,
        eventStream: false,
        transactionalWorkflows: true,
        d1BatchWorkflows: false,
      },
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    })
  })

  app.get('/api/openapi.json', async (c) => {
    const origin = resolveOrigin(c.req.raw, config)
    const spec = generateOpenAPISpec(blueprint, origin)
    const contract = agentContractMetadata(blueprint)
    Object.assign(spec, { 'x-zebric-contract': contract })
    return Response.json(spec, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        ETag: `"${contract.fingerprint}"`,
      },
    })
  })
}

function agentContractMetadata(blueprint: Blueprint): { version: '1'; fingerprint: string } {
  const canonicalContract = stableJsonValue(generateOpenAPISpec(blueprint))
  return {
    version: '1',
    fingerprint: `sha256:${createHash('sha256').update(JSON.stringify(canonicalContract)).digest('hex')}`,
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableJsonValue(nested)]))
  }
  return value
}

export function registerWidgetRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
  }
): void {
  const { blueprint, sessionManager, queryExecutor, workflowManager } = deps
  registerSharedWidgetRoutes(app, {
    blueprint,
    queryExecutor,
    sessionManager,
    triggerWorkflow: workflowManager
      ? (name, data) => { workflowManager.trigger(name, data, {}) }
      : undefined,
  })
}

export function registerSearchRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    queryExecutor: QueryExecutor
    sessionManager: SessionManager
  }
): void {
  registerSharedSearchRoutes(app, deps)
}

export function registerPageRoutes(app: Hono, blueprintAdapter: BlueprintHttpAdapter, csrfCookieName = 'csrf-token'): void {
  app.all('*', async (c) => {
    const response = await blueprintAdapter.handle(c.req.raw)
    const injectedCsrfToken = getInjectedCsrfTokenFromRequest(c.req.raw)
    const hasCsrfCookie = c.req.header('cookie')?.split(';').some((part) => part.trim().startsWith(`${csrfCookieName}=`))

    if (!injectedCsrfToken || hasCsrfCookie || !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase())) {
      return response
    }

    const headers = new Headers(response.headers)
    headers.append(
      'Set-Cookie',
      `${csrfCookieName}=${encodeURIComponent(injectedCsrfToken)}; Path=/; SameSite=Strict`
    )

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
