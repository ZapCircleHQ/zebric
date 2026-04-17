import {
  BlueprintParser,
  HTMLRenderer,
  RequestHandler,
  RouteMatcher,
  defaultTheme,
  type Blueprint,
  type HttpRequest,
  type HttpResponse,
  type Theme,
} from '@zebric/runtime-core'
import { SimulatorApiClient } from './api-simulator.js'
import { SimulatorAuditLogger } from './audit-logger.js'
import { defaultSimulatorAccounts, defaultSimulatorSeeds } from './defaults.js'
import { SimulatorIntegrationHost } from './integration-simulator.js'
import { BrowserMemoryQueryExecutor } from './memory-query-executor.js'
import { SimulatorLogger } from './logger.js'
import { SimulatorPluginHost } from './plugin-simulator.js'
import { SimulatorSessionManager } from './session-manager.js'
import { SimulatorWorkflowHost } from './workflow-simulator.js'
import type {
  ApiSimulationPolicy,
  PluginSimulationPolicy,
  RenderResult,
  SimulatorAccount,
  SimulatorSeeds,
  SubmitResult,
  WebhookSimulationResult,
  WorkflowStateEntry,
  ZebricSimulatorRuntimeConfig,
  ZebricSimulatorState,
} from './types.js'

export class ZebricSimulatorRuntime {
  private blueprint: Blueprint
  private seeds: SimulatorSeeds
  private activeSeed: string
  private accounts: SimulatorAccount[]
  private activeAccount: SimulatorAccount | null
  private activePath: string
  private origin: string
  private logger = new SimulatorLogger()
  private auditLogger = new SimulatorAuditLogger()
  private routeMatcher = new RouteMatcher()
  private queryExecutor: BrowserMemoryQueryExecutor
  private sessionManager: SimulatorSessionManager
  private renderer: HTMLRenderer
  private requestHandler: RequestHandler
  private workflowHost: SimulatorWorkflowHost
  private integrationHost: SimulatorIntegrationHost
  private pluginHost: SimulatorPluginHost
  private apiClient: SimulatorApiClient

  constructor(config: ZebricSimulatorRuntimeConfig, private theme: Theme = defaultTheme) {
    this.blueprint = resolveBlueprint(config)
    this.seeds = config.seeds && Object.keys(config.seeds).length > 0 ? config.seeds : defaultSimulatorSeeds
    this.activeSeed = config.initialSeed && this.seeds[config.initialSeed] ? config.initialSeed : Object.keys(this.seeds)[0]!
    this.accounts = config.accounts && config.accounts.length > 0 ? config.accounts : defaultSimulatorAccounts
    this.activeAccount = config.initialAccount === null
      ? null
      : this.accounts.find((account) => account.id === config.initialAccount) ?? this.accounts[0] ?? null
    this.activePath = this.blueprint.pages[0]?.path || '/'
    this.origin = config.origin || 'http://zebric-simulator.local'

    this.queryExecutor = new BrowserMemoryQueryExecutor(this.blueprint, this.seeds[this.activeSeed] || {}, this.logger)
    this.sessionManager = new SimulatorSessionManager(this.activeAccount)
    this.renderer = new HTMLRenderer(this.blueprint, this.theme)
    this.requestHandler = this.createRequestHandler()
    this.workflowHost = new SimulatorWorkflowHost(this.blueprint, this.logger)
    this.integrationHost = new SimulatorIntegrationHost(this.blueprint, this.logger)
    this.pluginHost = new SimulatorPluginHost(config.pluginPolicy || defaultPluginPolicy(), this.logger)
    this.apiClient = new SimulatorApiClient(config.apiPolicy || defaultApiPolicy(), this.logger)
  }

  setBlueprint(input: { blueprint?: Blueprint; blueprintToml?: string; blueprintJson?: string }, options: { resetData?: boolean } = {}): void {
    this.blueprint = resolveBlueprint(input)
    this.renderer = new HTMLRenderer(this.blueprint, this.theme)
    this.queryExecutor.setBlueprint(this.blueprint)
    this.requestHandler = this.createRequestHandler()
    this.workflowHost.setBlueprint(this.blueprint)
    this.integrationHost.setBlueprint(this.blueprint)

    if (options.resetData) {
      this.queryExecutor.loadSeed(this.seeds[this.activeSeed] || {})
    }

    if (!this.routeMatcher.match(this.activePath, this.blueprint.pages)) {
      this.activePath = this.blueprint.pages[0]?.path || '/'
    }
  }

  async render(path = this.activePath): Promise<RenderResult> {
    this.activePath = normalizePath(path)
    const match = this.routeMatcher.match(this.activePath, this.blueprint.pages)
    if (!match) {
      return {
        path: this.activePath,
        status: 404,
        html: this.renderer.render404(this.activePath),
      }
    }

    const response = await this.requestHandler.handleGet(match, this.createRequest('GET', this.activePath, undefined, 'text/html'))
    const result = this.toRenderResult(this.activePath, response)
    if (result.redirectedTo) {
      this.activePath = result.redirectedTo
      return this.render(result.redirectedTo)
    }
    this.logger.log({
      type: 'request',
      message: `GET ${this.activePath} -> ${response.status}`,
    })
    return result
  }

  async submit(path: string, method: string, body: Record<string, any>): Promise<SubmitResult> {
    const normalizedPath = normalizePath(path)
    const upperMethod = method.toUpperCase()

    if (normalizedPath.startsWith('/actions/')) {
      const workflowName = decodeURIComponent(normalizedPath.slice('/actions/'.length))
      const entry = this.simulateWorkflowTrigger(workflowName, body)
      const redirect = typeof body.redirect === 'string' ? body.redirect : this.activePath
      const rendered = await this.render(redirect)
      return { ...rendered, response: { success: entry.status !== 'failed', workflow: entry } }
    }

    const match = this.routeMatcher.match(normalizedPath, this.blueprint.pages)
    if (!match) {
      const rendered = await this.render(this.activePath)
      return { ...rendered, response: { success: false, error: `No page found for ${normalizedPath}` } }
    }

    const request = this.createRequest(upperMethod, normalizedPath, body, 'application/json')
    let response: HttpResponse
    if (upperMethod === 'PUT') {
      response = await this.requestHandler.handlePut(match, request)
    } else if (upperMethod === 'DELETE') {
      response = await this.requestHandler.handleDelete(match, request)
    } else {
      response = await this.requestHandler.handlePost(match, request)
    }

    const parsed = parseJsonBody(response.body)
    const redirect = typeof parsed?.redirect === 'string' ? parsed.redirect : undefined
    this.logger.log({
      type: 'request',
      message: `${upperMethod} ${normalizedPath} -> ${response.status}`,
      detail: parsed,
    })

    const rendered = await this.render(redirect || this.activePath)
    return { ...rendered, response: parsed ?? response.body }
  }

  switchAccount(accountId: string | null): void {
    const previousAccount = this.activeAccount
    this.activeAccount = accountId === null
      ? null
      : this.accounts.find((account) => account.id === accountId) ?? null
    this.sessionManager.setActiveAccount(this.activeAccount)

    if (previousAccount?.id === this.activeAccount?.id) {
      return
    }

    this.auditLogger.log({
      eventType: this.activeAccount ? 'auth.login.success' : 'auth.logout',
      severity: 'INFO',
      action: this.activeAccount ? 'User logged in' : 'User logged out',
      resource: 'auth',
      success: true,
      userId: this.activeAccount?.id ?? previousAccount?.id,
      metadata: {
        source: 'simulator.account_switch',
        previousUserId: previousAccount?.id,
        previousRole: previousAccount?.role,
        nextUserId: this.activeAccount?.id,
        nextRole: this.activeAccount?.role,
      },
    })
  }

  switchSeed(seedName: string): void {
    if (!this.seeds[seedName]) {
      throw new Error(`Seed not found: ${seedName}`)
    }
    this.activeSeed = seedName
    this.queryExecutor.loadSeed(this.seeds[seedName])
  }

  resetSeed(): void {
    this.queryExecutor.loadSeed(this.seeds[this.activeSeed] || {})
  }

  async triggerWorkflow(workflowName: string, payload?: unknown): Promise<RenderResult> {
    this.simulateWorkflowTrigger(workflowName, payload)
    this.auditLogger.log({
      eventType: 'workflow.trigger',
      severity: 'INFO',
      action: `Trigger workflow: ${workflowName}`,
      resource: workflowName,
      success: true,
      userId: this.activeAccount?.id,
      metadata: { payload },
    })
    return this.render(this.activePath)
  }

  triggerWebhook(
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    query: Record<string, string> = {}
  ): WebhookSimulationResult {
    const webhookPath = normalizePath(path)
    const matchedWorkflows = (this.blueprint.workflows || [])
      .filter((workflow) => workflow.trigger?.webhook === webhookPath)
      .map((workflow) => workflow.name)
    const payload = {
      webhook: {
        body,
        headers,
        query,
      },
      request: {
        path: webhookPath,
        headers,
        body,
        query,
      },
      source: 'webhook',
    }

    for (const workflowName of matchedWorkflows) {
      this.simulateWorkflowTrigger(workflowName, payload)
    }

    this.auditLogger.log({
      eventType: 'workflow.webhook',
      severity: matchedWorkflows.length > 0 ? 'INFO' : 'WARNING',
      action: `Trigger webhook: ${webhookPath}`,
      resource: webhookPath,
      success: matchedWorkflows.length > 0,
      userId: this.activeAccount?.id,
      metadata: {
        matchedWorkflows,
        body,
        headers,
        query,
      },
    })

    this.logger.log({
      type: 'workflow',
      message: `Webhook ${webhookPath} matched ${matchedWorkflows.length} workflow${matchedWorkflows.length === 1 ? '' : 's'}`,
      detail: { path: webhookPath, matchedWorkflows, body, headers, query },
    })

    return {
      path: webhookPath,
      status: matchedWorkflows.length > 0 ? 200 : 404,
      matchedWorkflows,
      body,
      headers,
      query,
    }
  }

  getState(): ZebricSimulatorState {
    return {
      blueprint: this.blueprint,
      activePath: this.activePath,
      activeSeed: this.activeSeed,
      activeAccount: this.activeAccount,
      accounts: [...this.accounts],
      data: this.queryExecutor.exportData(),
      audit: this.auditLogger.getEntries(),
      logs: this.logger.getEntries(),
      integrations: this.integrationHost.getEntries(),
      registeredWorkflows: this.workflowHost.getRegisteredWorkflows(),
      workflows: this.workflowHost.getEntries(),
    }
  }

  getPluginHost(): SimulatorPluginHost {
    return this.pluginHost
  }

  getApiClient(): SimulatorApiClient {
    return this.apiClient
  }

  private simulateWorkflowTrigger(workflowName: string, payload?: unknown): WorkflowStateEntry {
    const entry = this.workflowHost.trigger(workflowName, payload)
    const integrations = this.integrationHost.simulateWorkflow(workflowName, payload)

    if (integrations.length > 0) {
      entry.logs.push(
        ...integrations.map((integration) => integration.message)
      )
    }

    return entry
  }

  private createRequestHandler(): RequestHandler {
    return new RequestHandler({
      blueprint: this.blueprint,
      queryExecutor: this.queryExecutor,
      sessionManager: this.sessionManager,
      renderer: {
        renderPage: (context) => this.renderer.renderPage(context),
      },
      auditLogger: this.auditLogger,
      defaultOrigin: this.origin,
    })
  }

  private createRequest(method: string, path: string, body: unknown, accept: string): HttpRequest {
    return {
      method,
      url: `${this.origin}${normalizePath(path)}`,
      headers: {
        accept,
        'content-type': 'application/json',
      },
      body,
    }
  }

  private toRenderResult(path: string, response: HttpResponse): RenderResult {
    const location = response.headers.Location || response.headers.location
    return {
      path,
      status: response.status,
      html: typeof response.body === 'string' ? response.body : '',
      redirectedTo: location,
    }
  }
}

function resolveBlueprint(input: { blueprint?: Blueprint; blueprintToml?: string; blueprintJson?: string }): Blueprint {
  if (input.blueprint) {
    return input.blueprint
  }
  const parser = new BlueprintParser()
  if (input.blueprintToml !== undefined) {
    return parser.parse(input.blueprintToml, 'toml', 'simulator:blueprint.toml')
  }
  if (input.blueprintJson !== undefined) {
    return parser.parse(input.blueprintJson, 'json', 'simulator:blueprint.json')
  }
  throw new Error('Zebric simulator requires blueprint, blueprintToml, or blueprintJson')
}

function normalizePath(path: string): string {
  if (!path) {
    return '/'
  }
  try {
    const url = new URL(path, 'http://zebric-simulator.local')
    return url.pathname + url.search
  } catch {
    return path.startsWith('/') ? path : `/${path}`
  }
}

function parseJsonBody(body: HttpResponse['body']): any {
  if (typeof body !== 'string' || body.length === 0) {
    return undefined
  }
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function defaultPluginPolicy(): PluginSimulationPolicy {
  return { defaultLevel: 1 }
}

function defaultApiPolicy(): ApiSimulationPolicy {
  return { mode: 'debug' }
}
