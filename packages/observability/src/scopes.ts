import { createExecutionId } from './ids.js'
import type { Logger, RequestLogContext } from './types.js'

export function createRequestLogger(logger: Logger, context: RequestLogContext): Logger {
  return logger.child(context)
}

export function createWorkflowLogger(
  logger: Logger,
  workflowName: string,
  context: Record<string, unknown> = {}
): Logger {
  return logger.child({
    ...context,
    executionId: typeof context.executionId === 'string' ? context.executionId : createExecutionId(),
    workflowName,
  })
}

export function createPluginLogger(
  logger: Logger,
  pluginName: string,
  context: Record<string, unknown> = {}
): Logger {
  return logger.child({
    ...context,
    pluginName,
  })
}
