import type { Context } from 'hono'

export type AgentApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500

export interface AgentApiErrorEnvelope {
  error: {
    code: string
    message: string
    retryable: boolean
    requestId?: string
    details?: Record<string, unknown>
  }
}

export function agentApiError(
  c: Context,
  status: AgentApiErrorStatus,
  code: string,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown>; headers?: Record<string, string> } = {}
): Response {
  const requestId = (c as any).get('requestId') as string | undefined
  const body: AgentApiErrorEnvelope = {
    error: {
      code,
      message,
      retryable: options.retryable ?? (status === 429 || status >= 500),
      ...(requestId ? { requestId } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  }
  return Response.json(body, { status, headers: options.headers })
}
