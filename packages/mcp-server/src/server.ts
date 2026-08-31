import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'node:crypto'
import {
  createRuntimeReadTools,
  discoverZebricApplication,
  getRuntimeToolMetadata,
  InMemoryMutationExecutionStateStore,
  type RuntimeToolFactoryOptions,
} from '@zebric/agent'
import type { z } from 'zod'

export interface CreateZebricMcpServerOptions {
  applicationUrl: string
  applicationName?: string
  credential?: () => string | undefined | Promise<string | undefined>
  allowedMutations?: Iterable<string>
  fetch?: typeof globalThis.fetch
}

export async function createZebricMcpServer(options: CreateZebricMcpServerOptions): Promise<McpServer> {
  const contract = await discoverZebricApplication(options.applicationUrl, { fetch: options.fetch })
  const allowedMutations = new Set(options.allowedMutations ?? [])
  const applicationName = options.applicationName ?? 'zebric'
  const toolOptions: RuntimeToolFactoryOptions = {
    applicationName,
    credential: options.credential,
    fetch: options.fetch,
    ...(allowedMutations.size > 0 ? {
      mutations: {
        approve: request => allowedMutations.has(request.operationId),
        agentRunId: () => randomUUID(),
        state: new InMemoryMutationExecutionStateStore(),
      },
    } : {}),
  }
  const runtimeTools = createRuntimeReadTools(contract, toolOptions)
  const server = new McpServer({
    name: `zebric-${applicationName}`,
    version: '0.0.1',
  })

  for (const runtimeTool of runtimeTools) {
    const metadata = getRuntimeToolMetadata(runtimeTool)
    if (!metadata) throw new Error(`Missing Zebric metadata for tool ${runtimeTool.name}`)
    if (metadata.risk !== 'read' && !allowedMutations.has(metadata.operationId)) continue
    server.registerTool(runtimeTool.name, {
      description: runtimeTool.description,
      inputSchema: runtimeTool.schema as z.ZodType,
      annotations: {
        readOnlyHint: metadata.risk === 'read',
        destructiveHint: metadata.risk === 'destructive',
        idempotentHint: metadata.risk === 'read' || metadata.idempotencyRequired,
        openWorldHint: metadata.risk === 'external',
      },
      _meta: {
        'zebric/operationId': metadata.operationId,
        'zebric/risk': metadata.risk,
        'zebric/requiredScopes': metadata.requiredScopes,
      },
    }, async input => {
      const output = await runtimeTool.invoke(input as Record<string, unknown>)
      return {
        content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
      }
    })
  }

  return server
}
