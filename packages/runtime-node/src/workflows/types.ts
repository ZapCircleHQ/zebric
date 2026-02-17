/**
 * Workflow System Types
 *
 * Defines types for the workflow execution engine
 */

export interface WorkflowTrigger {
  entity?: string
  event?: 'create' | 'update' | 'delete'
  condition?: Record<string, any>
  webhook?: string  // Webhook path like "/webhooks/github"
  schedule?: string  // Cron expression
}

export interface WorkflowStep {
  type: 'query' | 'email' | 'webhook' | 'plugin' | 'condition' | 'loop' | 'delay' | 'notify'

  // Query step
  entity?: string
  action?: 'create' | 'update' | 'delete' | 'find'
  data?: Record<string, any>
  where?: Record<string, any>

  // Email step
  to?: string
  subject?: string
  template?: string
  body?: string

  // Webhook step
  url?: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  payload?: Record<string, any>

  // Plugin step
  plugin?: string
  action_name?: string
  params?: Record<string, any>

  // Condition step
  if?: Record<string, any>
  then?: WorkflowStep[]
  else?: WorkflowStep[]

  // Loop step
  items?: string  // Variable path like "context.items"
  do?: WorkflowStep[]

  // Delay step
  duration?: number  // Delay in milliseconds

  // Result assignment
  assignTo?: string  // Assign result to context variable
  // Notification step
  adapter?: string
  channel?: string
  metadata?: Record<string, any>
}

export interface Workflow {
  name: string
  description?: string
  trigger: WorkflowTrigger
  steps: WorkflowStep[]
  enabled?: boolean
  timeout?: number  // Timeout in milliseconds
  retries?: number  // Number of retries on failure
}

export interface WorkflowContext {
  trigger: {
    type: 'entity' | 'webhook' | 'schedule' | 'manual'
    entity?: string
    event?: string
    data?: any
    before?: any
    after?: any
  }
  variables: Record<string, any>
  session?: any
  request?: {
    headers: Record<string, string>
    body?: any
    query?: Record<string, string>
  }
}

export interface WorkflowJob {
  id: string
  workflowName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  context: WorkflowContext
  result?: any
  error?: string
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  attempts: number
}

export interface WorkflowExecutionResult {
  success: boolean
  result?: any
  error?: string
  logs: WorkflowLog[]
}

export interface WorkflowLog {
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: any
}
