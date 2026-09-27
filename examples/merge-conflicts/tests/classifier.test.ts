import { describe, expect, it } from 'vitest'
import { HeuristicClassifier } from '../src/classifier.js'
import { fixtureCatalog } from '../fixtures/catalog.js'
import type { ConflictFile } from '../src/types.js'

describe('HeuristicClassifier', () => {
  const classifier = new HeuristicClassifier()
  const classify = (overrides: Partial<ConflictFile>) => classifier.classify({ path: 'src/app.ts', base: 'const app = 1\n', ours: 'const app = 2\n', theirs: 'const app = 3\n', conflicted: '', ...overrides })

  it('classifies imports separately from workflow policy', async () => {
    const result = await classify({ base: 'run()\n', ours: "import { a } from './a.js'\nrun()\n", theirs: "import { b } from './b.js'\nrun()\n" })
    expect(result).toMatchObject({ kind: 'IMPORTS', risk: 'LOW', classifier: 'heuristic-conflict-classifier' })
  })

  it('raises risk for generated, dependency, configuration, and business-rule conflicts', async () => {
    await expect(classify({ path: 'pnpm-lock.yaml' })).resolves.toMatchObject({ kind: 'GENERATED', risk: 'HIGH' })
    await expect(classify({ path: 'package.json' })).resolves.toMatchObject({ kind: 'DEPENDENCY', risk: 'HIGH' })
    await expect(classify({ path: 'config/prod.toml' })).resolves.toMatchObject({ kind: 'CONFIGURATION', risk: 'HIGH' })
    await expect(classify({ path: 'src/permissions.ts' })).resolves.toMatchObject({ kind: 'IMPLEMENTATION', risk: 'HIGH' })
  })

  it('ships the requested breadth of documented fixtures', () => {
    expect(fixtureCatalog).toHaveLength(12)
    expect(new Set(fixtureCatalog.map(item => item.id)).size).toBe(12)
  })
})
