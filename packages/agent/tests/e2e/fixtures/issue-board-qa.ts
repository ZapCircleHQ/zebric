export interface IssueBoardQaTarget {
  taskId: string
  url: string
  revision: string
  acceptanceCriteria: string
  featureFlags?: Record<string, unknown>
  fixtureRef?: string
  requiredSuites?: string[]
  knownLimitations?: string
  destructiveTestingBoundaries?: string
}

export interface IssueBoardQaPlan {
  target: IssueBoardQaTarget
  checks: Array<{ name: string; instruction: string }>
}

export interface IssueBoardQaResult {
  summary: string
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'blocked' | 'inconclusive' }>
  artifacts: Array<{ type: string; url: string }>
  testedRevision: string
  testedEnvironment: string
}

/** Application-owned deterministic test double for the issue-board scenario. */
export class ScriptedIssueBoardQa {
  readonly inspectedTargets: IssueBoardQaTarget[] = []
  readonly executedPlans: IssueBoardQaPlan[] = []

  async inspectTarget(target: IssueBoardQaTarget) {
    this.inspectedTargets.push(target)
    return { reachable: true, environment: target.url, observedRevision: target.revision }
  }

  async execute(plan: IssueBoardQaPlan): Promise<IssueBoardQaResult> {
    this.executedPlans.push(plan)
    return {
      summary: 'Acceptance criteria passed.',
      checks: plan.checks.map(check => ({ name: check.name, status: 'passed' })),
      artifacts: [{ type: 'test_log', url: 'artifact://qa-run-1/log' }],
      testedRevision: plan.target.revision,
      testedEnvironment: plan.target.url,
    }
  }
}

/** Issue-board policy used only by this application fixture. */
export function selectIssueBoardQaCandidate<T extends {
  id: string
  important?: boolean
  position?: number
  createdAt?: string | number
}>(candidates: readonly T[]): T | undefined {
  return [...candidates].sort((left, right) =>
    Number(Boolean(right.important)) - Number(Boolean(left.important))
    || (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
    || timestamp(left.createdAt) - timestamp(right.createdAt)
    || left.id.localeCompare(right.id)
  )[0]
}

function timestamp(value: string | number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}
