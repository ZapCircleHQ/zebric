import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDeepAgent, type CreateDeepAgentParams } from 'deepagents'
import { tool } from 'langchain'
import { z } from 'zod'
import { validateBlueprint } from '../authoring/validate-blueprint.js'
import { discoverZebricApplication } from '../runtime/discovery-client.js'
import { createRuntimeReadTools } from '../runtime/action-tool-factory.js'
import type { RuntimeMutationOptions } from '../runtime/action-tool-factory.js'
import { resolveExistingWorkspacePath } from '../authoring/workspace-path.js'
import {
  getZebricAgentRuntimeContext,
  runWithZebricAgentRuntimeContext,
  type ZebricAgentRuntimeContext,
} from './runtime-context.js'

const SYSTEM_PROMPT = `You are Zebric Agent, a specialist for operating and authoring Zebric applications.

Use deterministic tools for Blueprint parsing and validation. Never infer that a Blueprint is valid from visual inspection alone. Runtime behavior, permissions, workflow preconditions, and published Agent API contracts are authoritative. Clearly distinguish validation errors from design suggestions. Do not expose credentials or invent application endpoints.`

export type ZebricAgentModel = string | object

export interface ZebricAgentInvokeOptions {
  threadId?: string
}

export interface ZebricAgent {
  invoke(input: unknown, options?: ZebricAgentInvokeOptions): Promise<unknown>
}

export interface CreateZebricAgentOptions {
  model: ZebricAgentModel
  workspaceRoot?: string
  workspace?: {
    root: string
    mode?: 'read-only' | 'read-write'
  }
  checkpointer?: unknown
  approval?: 'none' | 'writes-and-mutations'
  applications?: Array<{
    name: string
    baseUrl: string
    credential?: () => string | undefined | Promise<string | undefined>
    mutations?: RuntimeMutationOptions
  }>
  fetch?: typeof globalThis.fetch
}

export async function createZebricAgent(
  options: CreateZebricAgentOptions
): Promise<ZebricAgent> {
  validateOptions(options)
  const workspaceRoot = resolve(options.workspace?.root ?? options.workspaceRoot ?? process.cwd())
  const workspaceMode = options.workspace?.mode ?? 'read-only'
  const validateBlueprintTool = tool(
    async ({ path }) => {
      const result = await validateBlueprint({
        path: await resolveExistingWorkspacePath(workspaceRoot, path),
      })
      if (result.valid) {
        return JSON.stringify({
          valid: true,
          path: result.path,
          project: result.blueprint.project,
          entities: result.blueprint.entities.map(entity => entity.name),
          pages: result.blueprint.pages.map(page => page.path),
          workflows: result.blueprint.workflows?.map(workflow => workflow.name) ?? [],
          skills: result.blueprint.skills?.map(skill => skill.name) ?? [],
        })
      }
      return JSON.stringify(result)
    },
    {
      name: 'validate_blueprint',
      description: 'Parse and deterministically validate a TOML or JSON Zebric Blueprint inside the configured workspace.',
      schema: z.object({
        path: z.string().describe('Workspace-relative path to the Blueprint.'),
      }),
    }
  )

  const runtimeTools = []
  for (const application of options.applications ?? []) {
    const contract = await discoverZebricApplication(application.baseUrl, { fetch: options.fetch })
    runtimeTools.push(...createRuntimeReadTools(contract, {
      applicationName: application.name,
      credential: application.credential,
      fetch: options.fetch,
      mutations: application.mutations ? {
        ...application.mutations,
        agentRunId: application.mutations.agentRunId
          ?? (() => getZebricAgentRuntimeContext()?.runId ?? ''),
      } : undefined,
      correlationId: () => getZebricAgentRuntimeContext()?.correlationId,
    }))
  }

  const graph = createDeepAgent({
    name: 'zebric-agent',
    model: options.model as NonNullable<CreateDeepAgentParams['model']>,
    systemPrompt: SYSTEM_PROMPT,
    tools: [validateBlueprintTool, ...runtimeTools],
    checkpointer: options.checkpointer as CreateDeepAgentParams['checkpointer'],
    interruptOn: {},
  })

  return {
    async invoke(input, invokeOptions = {}) {
      const context: ZebricAgentRuntimeContext = {
        runId: randomUUID(),
        correlationId: randomUUID(),
        ...(invokeOptions.threadId ? { threadId: invokeOptions.threadId } : {}),
        workspace: { root: workspaceRoot, mode: workspaceMode },
        applications: (options.applications ?? []).map(application => application.name),
        policy: { approval: options.approval ?? 'writes-and-mutations' },
      }
      return runWithZebricAgentRuntimeContext(context, () => graph.invoke(
        input as never,
        invokeOptions.threadId
          ? { configurable: { thread_id: invokeOptions.threadId } }
          : undefined
      ))
    },
  }
}

function validateOptions(options: CreateZebricAgentOptions): void {
  if (!options.model || (typeof options.model !== 'string' && typeof options.model !== 'object')) {
    throw new TypeError('Zebric agent model must be a model identifier or model object')
  }
  if (options.workspaceRoot && options.workspace) {
    throw new TypeError('Configure workspace or workspaceRoot, not both')
  }
  const names = new Set<string>()
  for (const application of options.applications ?? []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(application.name)) {
      throw new TypeError(`Invalid Zebric application name: ${application.name}`)
    }
    if (names.has(application.name.toLowerCase())) {
      throw new TypeError(`Duplicate Zebric application name: ${application.name}`)
    }
    names.add(application.name.toLowerCase())
    let url: URL
    try {
      url = new URL(application.baseUrl)
    } catch {
      throw new TypeError(`Invalid Zebric application URL for ${application.name}`)
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new TypeError(`Zebric application URL for ${application.name} must be an HTTP(S) URL without credentials`)
    }
  }
}
