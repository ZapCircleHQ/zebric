import { AsyncLocalStorage } from 'node:async_hooks'

export interface ZebricAgentRuntimeContext {
  runId: string
  correlationId: string
  threadId?: string
  workspace: {
    root: string
    mode: 'read-only' | 'read-write'
  }
  applications: readonly string[]
  policy: {
    approval: 'none' | 'writes-and-mutations'
  }
}

const runtimeContext = new AsyncLocalStorage<ZebricAgentRuntimeContext>()

export function getZebricAgentRuntimeContext(): ZebricAgentRuntimeContext | undefined {
  return runtimeContext.getStore()
}

export function runWithZebricAgentRuntimeContext<T>(
  context: ZebricAgentRuntimeContext,
  callback: () => Promise<T>
): Promise<T> {
  return runtimeContext.run(context, callback)
}
