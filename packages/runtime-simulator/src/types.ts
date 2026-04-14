import type { AuditEvent, Blueprint, UserSession } from '@zebric/runtime-core'

export type SimulatorPluginLevel = 0 | 1 | 2 | 3

export interface SimulatorAccount {
  id: string
  email: string
  name: string
  role: string
  roles?: string[]
  [key: string]: unknown
}

export type SimulatorSeedData = Record<string, Array<Record<string, unknown>>>

export interface SimulatorSeeds {
  [name: string]: SimulatorSeedData
}

export interface PluginSimulationPolicy {
  defaultLevel: SimulatorPluginLevel
  perPlugin?: Record<string, SimulatorPluginLevel>
}

export interface ApiSimulationMock {
  match: string | RegExp
  status?: number
  response: unknown
}

export interface ApiSimulationPolicy {
  mode: 'noop' | 'debug' | 'mock'
  mocks?: ApiSimulationMock[]
}

export interface SimulatorLogEntry {
  id: string
  timestamp: number
  type: 'request' | 'query' | 'mutation' | 'plugin' | 'api' | 'workflow' | 'integration' | 'error'
  message: string
  detail?: unknown
}

export type SimulatedIntegrationKind = 'slack' | 'email' | 'webhook' | 'notification'

export interface SimulatedIntegrationEntry {
  id: string
  timestamp: number
  kind: SimulatedIntegrationKind
  workflowName: string
  stepIndex: number
  status: 'simulated' | 'skipped' | 'failed'
  adapter?: string
  adapterType?: string
  channel?: string
  to?: string
  subject?: string
  body?: string
  template?: string
  params?: unknown
  metadata?: unknown
  url?: string
  method?: string
  headers?: Record<string, string>
  payload?: unknown
  message: string
}

export interface WorkflowStateEntry {
  id: string
  timestamp: number
  workflowName: string
  status: 'skipped' | 'debug' | 'completed' | 'failed'
  payload?: unknown
  logs: string[]
}

export interface WorkflowSummary {
  name: string
  trigger: unknown
  stepCount: number
  steps: string[]
}

export interface RenderResult {
  path: string
  status: number
  html: string
  redirectedTo?: string
}

export interface SubmitResult extends RenderResult {
  response: unknown
}

export interface ZebricSimulatorRuntimeConfig {
  blueprint?: Blueprint
  blueprintToml?: string
  blueprintJson?: string
  seeds?: SimulatorSeeds
  initialSeed?: string
  accounts?: SimulatorAccount[]
  initialAccount?: string | null
  pluginPolicy?: PluginSimulationPolicy
  apiPolicy?: ApiSimulationPolicy
  origin?: string
}

export interface ZebricSimulatorState {
  blueprint: Blueprint
  activePath: string
  activeSeed: string
  activeAccount: SimulatorAccount | null
  accounts: SimulatorAccount[]
  data: SimulatorSeeds[string]
  audit: AuditEvent[]
  logs: SimulatorLogEntry[]
  integrations: SimulatedIntegrationEntry[]
  registeredWorkflows: WorkflowSummary[]
  workflows: WorkflowStateEntry[]
}

export type SimulatorSession = UserSession
