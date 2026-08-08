import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { validateBlueprint } from './validate-blueprint.js'

describe('validateBlueprint', () => {
  it('validates the issue-board reference Blueprint', async () => {
    const result = await validateBlueprint({
      path: resolve(process.cwd(), '../../examples/issue-board/blueprint.toml'),
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.blueprint.project.name).toBe('Issue Board')
      expect(result.blueprint.skills?.[0]?.name).toBe('issue_board')
    }
  })
})
