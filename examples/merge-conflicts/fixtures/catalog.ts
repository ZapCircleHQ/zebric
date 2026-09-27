import type { ConflictKind, Risk } from '../src/types.js'

export interface FixtureExpectation {
  id: string
  description: string
  path: string
  classification: ConflictKind
  risk: Risk
  route: 'deterministic' | 'agent' | 'human'
  human: boolean
}

/** The catalog is executable documentation; real-Git tests cover representative routes. */
export const fixtureCatalog: FixtureExpectation[] = [
  { id: 'duplicate-import', description: 'Both branches add the same import', path: 'src/app.ts', classification: 'IMPORTS', risk: 'LOW', route: 'deterministic', human: false },
  { id: 'import-ordering', description: 'Branches add different imports at the same location', path: 'src/app.ts', classification: 'IMPORTS', risk: 'LOW', route: 'deterministic', human: false },
  { id: 'additive', description: 'Branches append independent registrations', path: 'src/routes.ts', classification: 'ADDITIVE', risk: 'LOW', route: 'deterministic', human: false },
  { id: 'documentation', description: 'Both branches rewrite the same instructions', path: 'README.md', classification: 'DOCUMENTATION', risk: 'LOW', route: 'agent', human: false },
  { id: 'dependency-version', description: 'Branches choose incompatible dependency versions', path: 'package.json', classification: 'DEPENDENCY', risk: 'HIGH', route: 'human', human: true },
  { id: 'generated-lockfile', description: 'Package manager lockfile conflicts', path: 'pnpm-lock.yaml', classification: 'GENERATED', risk: 'HIGH', route: 'human', human: true },
  { id: 'configuration', description: 'Deployment settings disagree', path: 'config/production.toml', classification: 'CONFIGURATION', risk: 'HIGH', route: 'human', human: true },
  { id: 'implementation', description: 'Same function has competing implementations', path: 'src/calculate.ts', classification: 'IMPLEMENTATION', risk: 'MEDIUM', route: 'agent', human: false },
  { id: 'business-rule', description: 'Competing authorization policy', path: 'src/permissions.ts', classification: 'IMPLEMENTATION', risk: 'HIGH', route: 'human', human: true },
  { id: 'test-expectation', description: 'Tests assert different behavior', path: 'tests/calculate.test.ts', classification: 'TEST', risk: 'MEDIUM', route: 'agent', human: false },
  { id: 'ambiguous-intent', description: 'Names and behavior provide insufficient intent', path: 'src/value.ts', classification: 'IMPLEMENTATION', risk: 'MEDIUM', route: 'agent', human: true },
  { id: 'unsupported-binary', description: 'Classifier cannot interpret the artifact', path: 'assets/data.bin', classification: 'UNKNOWN', risk: 'UNKNOWN', route: 'human', human: true },
]
