export const conflictKinds = [
  'IMPORTS', 'FORMATTING', 'ADDITIVE', 'GENERATED', 'DEPENDENCY',
  'IMPLEMENTATION', 'TEST', 'CONFIGURATION', 'DOCUMENTATION', 'UNKNOWN',
] as const

export type ConflictKind = typeof conflictKinds[number]
export type Risk = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
export type ResolutionState =
  | 'detected' | 'analyzing' | 'resolving' | 'validating' | 'awaiting_approval'
  | 'approved' | 'applying' | 'completed' | 'failed' | 'abandoned'

export interface PullRequestMetadata {
  repository: string
  number?: number
  title: string
  body?: string
  baseRef: string
  headRef: string
  headSha?: string
}

export interface ConflictFile {
  path: string
  base: string
  ours: string
  theirs: string
  conflicted: string
}

export interface Classification {
  kind: ConflictKind
  risk: Risk
  classifier: string
  modelVersion: string
  reasons: string[]
}

export interface CandidateResolution {
  path: string
  content: string
  source: 'deterministic' | 'agent'
  resolver: string
  explanation: string
  assumptions: string[]
  requiresHumanReview: boolean
}

export interface ValidationCheck {
  name: string
  passed: boolean
  output: string
}

export interface ValidationResult {
  passed: boolean
  checks: ValidationCheck[]
}

export interface AttemptEvidence {
  number: number
  candidate: CandidateResolution
  validation: ValidationResult
}

export interface AuditEvent {
  at: string
  resolutionId: string
  type: string
  data: Record<string, unknown>
}

export interface ResolutionRecord {
  id: string
  state: ResolutionState
  pullRequest: PullRequestMetadata
  classifications: Record<string, Classification>
  attempts: AttemptEvidence[]
  pendingCandidate?: CandidateResolution
  publishedCommit?: string
  failure?: string
}

export interface RepositoryAdapter {
  getMetadata(): Promise<PullRequestMetadata>
  getConflicts(): Promise<ConflictFile[]>
  getRelevantHistory(path: string, limit?: number): Promise<string[]>
  applyCandidate(candidate: CandidateResolution): Promise<void>
  validate(commands: string[], paths?: string[]): Promise<ValidationResult>
  publish(message: string): Promise<{ commit: string; url?: string }>
}

export interface ConflictClassifier {
  readonly name: string
  readonly version: string
  classify(file: ConflictFile): Promise<Classification>
}

export interface AgentContext {
  pullRequest: PullRequestMetadata
  file: ConflictFile
  classification: Classification
  history: string[]
  previousAttempts: AttemptEvidence[]
}

export interface ResolutionAgent {
  readonly name: string
  propose(context: AgentContext): Promise<CandidateResolution>
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>
}
