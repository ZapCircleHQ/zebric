import type { Workflow, WorkflowStep } from '../types/blueprint.js'

export interface TransactionalWorkflowAnalysis {
  databaseOnly: boolean
  d1BatchEligible: boolean
  reasons: string[]
}

/** Classify a transactional workflow without relying on a particular runtime. */
export function analyzeTransactionalWorkflow(workflow: Workflow): TransactionalWorkflowAnalysis {
  const reasons: string[] = []
  let databaseOnly = true
  let d1BatchEligible = true
  const assignedResults = new Set<string>()

  const collectAssignments = (steps: WorkflowStep[]): void => {
    for (const step of steps) {
      if ((step as any).assignTo) assignedResults.add(String((step as any).assignTo))
      collectAssignments(((step as any).then ?? []) as WorkflowStep[])
      collectAssignments(((step as any).else ?? []) as WorkflowStep[])
      collectAssignments(((step as any).do ?? []) as WorkflowStep[])
    }
  }
  collectAssignments(workflow.steps)

  const visit = (steps: WorkflowStep[], path: string): void => {
    steps.forEach((step, index) => {
      const stepPath = `${path}[${index}]`
      switch (step.type as string) {
        case 'query':
          if (!['create', 'update', 'delete'].includes(String((step as any).action))) {
            d1BatchEligible = false
            reasons.push(`${stepPath} uses query action "${String((step as any).action)}"`)
          }
          for (const assigned of assignedResults) {
            if (referencesVariable(step, assigned)) {
              d1BatchEligible = false
              reasons.push(`${stepPath} depends on intermediate result "${assigned}"`)
            }
          }
          break
        case 'condition':
          d1BatchEligible = false
          reasons.push(`${stepPath} contains dynamic control flow`)
          visit(((step as any).then ?? []) as WorkflowStep[], `${stepPath}.then`)
          visit(((step as any).else ?? []) as WorkflowStep[], `${stepPath}.else`)
          break
        case 'loop':
          d1BatchEligible = false
          reasons.push(`${stepPath} contains a loop`)
          visit(((step as any).do ?? []) as WorkflowStep[], `${stepPath}.do`)
          break
        default:
          databaseOnly = false
          d1BatchEligible = false
          reasons.push(`${stepPath} has non-database effect "${String(step.type)}"`)
      }
    })
  }

  visit(workflow.steps, `workflow.${workflow.name}.steps`)
  return { databaseOnly, d1BatchEligible, reasons: [...new Set(reasons)] }
}

function referencesVariable(value: unknown, variable: string): boolean {
  if (typeof value === 'string') {
    return value.includes(`variables.${variable}`)
  }
  if (Array.isArray(value)) return value.some(item => referencesVariable(item, variable))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) =>
      key !== 'assignTo' && referencesVariable(item, variable)
    )
  }
  return false
}
