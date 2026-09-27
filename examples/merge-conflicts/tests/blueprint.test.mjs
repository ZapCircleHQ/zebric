import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BlueprintParser } from '../../../packages/runtime-core/src/blueprint/loader.ts'

describe('review blueprint', () => {
  it('parses with the current Zebric schema', async () => {
    const source = await readFile(new URL('../blueprint.toml', import.meta.url), 'utf8')
    const blueprint = new BlueprintParser().parse(source, 'toml', 'examples/merge-conflicts/blueprint.toml')
    expect(blueprint.entities.map(entity => entity.name)).toEqual(expect.arrayContaining([
      'Repository', 'PullRequest', 'ConflictResolution', 'ConflictFile', 'ResolutionAttempt', 'ReviewDecision',
    ]))
    expect(blueprint.workflows?.map(workflow => workflow.name)).toEqual(['ApproveResolution', 'RejectResolution'])
  })
})
