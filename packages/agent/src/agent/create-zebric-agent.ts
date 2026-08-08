import { resolve, relative, isAbsolute } from 'node:path'
import { createDeepAgent, type CreateDeepAgentParams } from 'deepagents'
import { tool } from 'langchain'
import { z } from 'zod'
import { validateBlueprint } from '../authoring/validate-blueprint.js'

const SYSTEM_PROMPT = `You are Zebric Agent, a specialist for operating and authoring Zebric applications.

Use deterministic tools for Blueprint parsing and validation. Never infer that a Blueprint is valid from visual inspection alone. Runtime behavior, permissions, workflow preconditions, and published Agent API contracts are authoritative. Clearly distinguish validation errors from design suggestions. Do not expose credentials or invent application endpoints.`

export interface CreateZebricAgentOptions {
  model: NonNullable<CreateDeepAgentParams['model']>
  workspaceRoot?: string
  checkpointer?: CreateDeepAgentParams['checkpointer']
}

function resolveWorkspacePath(root: string, requestedPath: string): string {
  const target = resolve(root, requestedPath)
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromRoot)) {
    throw new Error('Blueprint path is outside the configured workspace')
  }
  return target
}

export function createZebricAgent(options: CreateZebricAgentOptions) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  const validateBlueprintTool = tool(
    async ({ path }) => {
      const result = await validateBlueprint({
        path: resolveWorkspacePath(workspaceRoot, path),
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

  return createDeepAgent({
    name: 'zebric-agent',
    model: options.model,
    systemPrompt: SYSTEM_PROMPT,
    tools: [validateBlueprintTool],
    checkpointer: options.checkpointer,
    interruptOn: {},
  })
}
