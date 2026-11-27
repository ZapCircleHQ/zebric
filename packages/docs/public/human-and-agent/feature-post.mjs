import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createRuntimeReadTools,
  DeterministicAgentDriver,
  discoverZebricApplication,
} from '@zebric/agent'

// Explicit tool selection uses the same generated tools as a model-driven agent.
export async function featurePost({ baseUrl, id, credential }) {
  if (!id || !credential) throw new Error('Supply a post ID and FEATURE_POST_API_KEY.')
  const contract = await discoverZebricApplication(baseUrl)
  const runId = `feature-tutorial:${randomUUID()}`
  const tools = createRuntimeReadTools(contract, {
    applicationName: 'blog',
    credential: () => credential,
    mutations: {
      agentRunId: () => runId,
      approve: request => request.operationId === 'feature_post'
        && request.method === 'POST' && request.input.id === id,
    },
  })
  const driver = new DeterministicAgentDriver(tools)
  return driver.invoke({ tool: 'blog_feature_post', input: { id } })
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    const result = await featurePost({
      baseUrl: process.env.ZEBRIC_URL ?? 'http://localhost:3000',
      id: process.argv[2],
      credential: process.env.FEATURE_POST_API_KEY,
    })
    console.log(result)
  } catch (error) {
    console.error(`${error?.code ? `${error.code}: ` : ''}${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
