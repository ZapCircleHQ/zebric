import { randomUUID } from 'node:crypto'
import { resolveAdditive, resolveFormatting, resolveImports } from './resolvers.js'
import type {
  AgentContext, AuditSink, CandidateResolution, Classification, ConflictClassifier,
  ConflictFile, RepositoryAdapter, ResolutionAgent, ResolutionRecord,
} from './types.js'

export interface WorkflowOptions {
  validationCommands?: string[]
  maxAgentAttempts?: number
  autoPublish?: boolean
}

export class MergeConflictWorkflow {
  constructor(
    private readonly repository: RepositoryAdapter,
    private readonly classifier: ConflictClassifier,
    private readonly agent: ResolutionAgent,
    private readonly audit: AuditSink,
    private readonly options: WorkflowOptions = {},
  ) {}

  async run(): Promise<ResolutionRecord> {
    const record: ResolutionRecord = {
      id: randomUUID(), state: 'detected', pullRequest: await this.repository.getMetadata(),
      classifications: {}, attempts: [],
    }
    await this.event(record, 'workflow.detected', { pullRequest: record.pullRequest })
    try {
      record.state = 'analyzing'
      const files = await this.repository.getConflicts()
      await this.event(record, 'conflicts.inspected', { paths: files.map(file => file.path) })
      if (files.length === 0) throw new Error('Repository has no unmerged files')

      let requiresApproval = false
      for (const file of files) {
        const classification = await this.classifier.classify(file)
        record.classifications[file.path] = classification
        await this.event(record, 'conflict.classified', { path: file.path, ...classification })
        const outcome = await this.resolveFile(record, file, classification)
        if (outcome === 'approval') requiresApproval = true
      }

      if (requiresApproval) {
        record.state = 'awaiting_approval'
        return record
      }

      if (this.options.autoPublish === false) {
        record.state = 'awaiting_approval'
        await this.event(record, 'approval.requested', { reason: 'automatic publishing disabled' })
        return record
      }
      return this.publish(record)
    } catch (error) {
      record.state = 'failed'; record.failure = error instanceof Error ? error.message : String(error)
      await this.event(record, 'workflow.failed', { error: record.failure })
      return record
    }
  }

  async approve(record: ResolutionRecord, reviewer: string): Promise<ResolutionRecord> {
    if (record.state !== 'awaiting_approval') throw new Error(`Cannot approve resolution in state ${record.state}`)
    record.state = 'approved'
    await this.event(record, 'approval.approved', { reviewer })
    return this.publish(record)
  }

  async reject(record: ResolutionRecord, reviewer: string, reason: string): Promise<ResolutionRecord> {
    if (record.state !== 'awaiting_approval') throw new Error(`Cannot reject resolution in state ${record.state}`)
    record.state = 'abandoned'
    await this.event(record, 'approval.rejected', { reviewer, reason })
    return record
  }

  private async resolveFile(record: ResolutionRecord, file: ConflictFile, classification: Classification): Promise<'resolved' | 'approval'> {
    record.state = 'resolving'
    const deterministic = this.deterministic(file, classification)
    if (deterministic) {
      const passed = await this.tryCandidate(record, deterministic)
      if (!passed) throw new Error(`Deterministic resolution failed validation for ${file.path}`)
      return 'resolved'
    }

    const max = this.options.maxAgentAttempts ?? 2
    for (let attempt = 0; attempt < max; attempt++) {
      const context: AgentContext = {
        pullRequest: record.pullRequest, file, classification,
        history: await this.repository.getRelevantHistory(file.path),
        previousAttempts: record.attempts.filter(item => item.candidate.path === file.path),
      }
      await this.event(record, 'agent.invoked', {
        agent: this.agent.name, path: file.path, attempt: attempt + 1,
        context: { classification, history: context.history, previousAttemptCount: context.previousAttempts.length },
      })
      const candidate = await this.agent.propose(context)
      const passed = await this.tryCandidate(record, candidate)
      if (!passed) continue
      if (candidate.requiresHumanReview || classification.risk === 'HIGH' || classification.risk === 'UNKNOWN' || classification.kind === 'UNKNOWN') {
        record.state = 'awaiting_approval'; record.pendingCandidate = candidate
        await this.event(record, 'approval.requested', { path: file.path, reason: 'policy requires review' })
        return 'approval'
      }
      return 'resolved'
    }
    record.state = 'awaiting_approval'
    await this.event(record, 'approval.requested', { path: file.path, reason: `validation failed after ${max} bounded attempts` })
    return 'approval'
  }

  private deterministic(file: ConflictFile, classification: Classification): CandidateResolution | undefined {
    if (classification.risk !== 'LOW') return undefined
    if (classification.kind === 'IMPORTS') return resolveImports(file)
    if (classification.kind === 'FORMATTING') return resolveFormatting(file)
    if (classification.kind === 'ADDITIVE') return resolveAdditive(file)
    return undefined
  }

  private async tryCandidate(record: ResolutionRecord, candidate: CandidateResolution): Promise<boolean> {
    await this.repository.applyCandidate(candidate)
    record.state = 'validating'
    const validation = await this.repository.validate(this.options.validationCommands ?? [], [candidate.path])
    record.attempts.push({ number: record.attempts.length + 1, candidate, validation })
    await this.event(record, 'candidate.validated', {
      path: candidate.path, source: candidate.source, resolver: candidate.resolver,
      explanation: candidate.explanation, assumptions: candidate.assumptions, validation,
    })
    return validation.passed
  }

  private async publish(record: ResolutionRecord): Promise<ResolutionRecord> {
    record.state = 'applying'
    const finalValidation = await this.repository.validate(this.options.validationCommands ?? [])
    await this.event(record, 'resolution.validated', { validation: finalValidation })
    if (!finalValidation.passed) {
      record.state = 'awaiting_approval'
      throw new Error('Repository-wide validation failed before publication')
    }
    const result = await this.repository.publish(`Resolve merge conflicts for ${record.pullRequest.title}`)
    record.state = 'completed'; record.publishedCommit = result.commit
    await this.event(record, 'workflow.completed', result)
    return record
  }

  private async event(record: ResolutionRecord, type: string, data: Record<string, unknown>): Promise<void> {
    await this.audit.append({ at: new Date().toISOString(), resolutionId: record.id, type, data })
  }
}
