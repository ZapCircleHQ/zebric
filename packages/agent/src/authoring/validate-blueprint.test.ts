import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { validateBlueprint } from './validate-blueprint.js'

describe('validateBlueprint', () => {
  it('validates the issue-board reference Blueprint', async () => {
    const result = await validateBlueprint({
      path: fileURLToPath(new URL('../../../../examples/issue-board/blueprint.toml', import.meta.url)),
    })

    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.blueprint.project.name).toBe('Issue Board')
      expect(result.blueprint.skills?.[0]?.name).toBe('issue_board')
    }
  })
})
