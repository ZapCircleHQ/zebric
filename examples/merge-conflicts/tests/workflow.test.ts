import { afterEach, describe, expect, it } from 'vitest'
import { MemoryAuditSink } from '../src/audit.js'
import { HeuristicClassifier } from '../src/classifier.js'
import { LocalGitRepositoryAdapter } from '../src/local-git-adapter.js'
import type { AgentContext, CandidateResolution, ResolutionAgent } from '../src/types.js'
import { MergeConflictWorkflow } from '../src/workflow.js'
import { createConflict, createConflicts, type GitFixture } from './git-fixture.js'

class FakeAgent implements ResolutionAgent {
  readonly name = 'fixture-agent'
  calls: AgentContext[] = []
  constructor(private readonly proposeCandidate: (context: AgentContext) => CandidateResolution) {}
  async propose(context: AgentContext): Promise<CandidateResolution> { this.calls.push(context); return this.proposeCandidate(context) }
}

describe('MergeConflictWorkflow', () => {
  let fixture: GitFixture | undefined
  afterEach(async () => fixture?.cleanup())

  it('uses an agent for implementation conflicts, validates, and publishes', async () => {
    fixture = await createConflict({ base: 'export const value = 1\n', ours: 'export const value = 2\n', theirs: 'export const value = 3\n' })
    const audit = new MemoryAuditSink()
    const agent = new FakeAgent(ctx => ({ path: ctx.file.path, content: 'export const value = 4\n', source: 'agent', resolver: 'fixture-agent', explanation: 'intent combined', assumptions: ['four is desired'], requiresHumanReview: false }))
    const workflow = new MergeConflictWorkflow(new LocalGitRepositoryAdapter({ worktree: fixture.root }), new HeuristicClassifier(), agent, audit)
    const result = await workflow.run()
    expect(result.state).toBe('completed')
    expect(result.attempts).toHaveLength(1)
    expect(audit.events.map(event => event.type)).toEqual(expect.arrayContaining(['conflict.classified', 'agent.invoked', 'candidate.validated', 'workflow.completed']))
  })

  it('requires human approval for high-risk conflicts and records the reviewer', async () => {
    fixture = await createConflict({ path: 'config/production.toml', base: 'replicas = 1\n', ours: 'replicas = 2\n', theirs: 'replicas = 3\n' })
    const audit = new MemoryAuditSink()
    const agent = new FakeAgent(ctx => ({ path: ctx.file.path, content: 'replicas = 3\n', source: 'agent', resolver: 'fixture-agent', explanation: 'prefer capacity', assumptions: [], requiresHumanReview: false }))
    const workflow = new MergeConflictWorkflow(new LocalGitRepositoryAdapter({ worktree: fixture.root }), new HeuristicClassifier(), agent, audit)
    const pending = await workflow.run()
    expect(pending.state).toBe('awaiting_approval')
    const completed = await workflow.approve(pending, 'reviewer@example.test')
    expect(completed.state).toBe('completed')
    expect(audit.events.find(event => event.type === 'approval.approved')?.data).toEqual({ reviewer: 'reviewer@example.test' })
  })

  it('bounds failed agent attempts and escalates with prior evidence', async () => {
    fixture = await createConflict({ base: 'export const value = 1\n', ours: 'export const value = 2\n', theirs: 'export const value = 3\n' })
    const agent = new FakeAgent(ctx => ({ path: ctx.file.path, content: '<<<<<<< still broken\n', source: 'agent', resolver: 'fixture-agent', explanation: 'bad proposal', assumptions: [], requiresHumanReview: false }))
    const workflow = new MergeConflictWorkflow(new LocalGitRepositoryAdapter({ worktree: fixture.root }), new HeuristicClassifier(), agent, new MemoryAuditSink(), { maxAgentAttempts: 2 })
    const result = await workflow.run()
    expect(result.state).toBe('awaiting_approval')
    expect(result.attempts).toHaveLength(2)
    expect(agent.calls[1]?.previousAttempts).toHaveLength(1)
  })

  it('resolves every file before one review gate and publishes only after approval', async () => {
    fixture = await createConflicts([
      { path: 'src/value.ts', base: 'export const value = 1\n', ours: 'export const value = 2\n', theirs: 'export const value = 3\n' },
      { path: 'config/prod.toml', base: 'replicas = 1\n', ours: 'replicas = 2\n', theirs: 'replicas = 3\n' },
    ])
    const agent = new FakeAgent(ctx => ({ path: ctx.file.path, content: ctx.file.theirs, source: 'agent', resolver: 'fixture-agent', explanation: 'prefer feature', assumptions: [], requiresHumanReview: false }))
    const workflow = new MergeConflictWorkflow(new LocalGitRepositoryAdapter({ worktree: fixture.root }), new HeuristicClassifier(), agent, new MemoryAuditSink())
    const pending = await workflow.run()
    expect(pending.state).toBe('awaiting_approval')
    expect(pending.attempts).toHaveLength(2)
    await expect(workflow.approve(pending, 'reviewer@example.test')).resolves.toMatchObject({ state: 'completed' })
  })
})
