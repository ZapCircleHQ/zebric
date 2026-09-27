import type { Classification, ConflictClassifier, ConflictFile, ConflictKind, Risk } from './types.js'

const generatedNames = /(^|\/)(dist|generated|vendor)\/|\.lock$|package-lock\.json$|pnpm-lock\.yaml$/
const dependencyNames = /(^|\/)(package\.json|Cargo\.toml|requirements[^/]*\.txt|Gemfile)$/
const configNames = /(^|\/)(\.github\/|[^/]+\.(toml|ya?ml|json|ini|conf))$/
const testNames = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[^.]+$/
const docsNames = /(^|\/)(docs?\/|README|CHANGELOG)|\.mdx?$/i

/**
 * Deterministic baseline and offline fallback for Jev. It deliberately returns
 * structured evidence; routing remains the workflow's responsibility.
 */
export class HeuristicClassifier implements ConflictClassifier {
  readonly name = 'heuristic-conflict-classifier'
  readonly version = '1.0.0'

  async classify(file: ConflictFile): Promise<Classification> {
    const reasons: string[] = []
    let kind: ConflictKind = 'IMPLEMENTATION'
    let risk: Risk = 'MEDIUM'

    if (generatedNames.test(file.path)) {
      kind = 'GENERATED'; risk = 'HIGH'; reasons.push('path identifies a generated or lock file')
    } else if (dependencyNames.test(file.path)) {
      kind = 'DEPENDENCY'; risk = 'HIGH'; reasons.push('file declares dependencies')
    } else if (testNames.test(file.path)) {
      kind = 'TEST'; risk = 'MEDIUM'; reasons.push('path identifies test code')
    } else if (docsNames.test(file.path)) {
      kind = 'DOCUMENTATION'; risk = 'LOW'; reasons.push('path identifies documentation')
    } else if (configNames.test(file.path)) {
      kind = 'CONFIGURATION'; risk = 'HIGH'; reasons.push('path identifies configuration')
    } else if (this.onlyImportsChanged(file)) {
      kind = 'IMPORTS'; risk = 'LOW'; reasons.push('both sides only change import/use/include statements')
    } else if (this.isWhitespaceOnly(file)) {
      kind = 'FORMATTING'; risk = 'LOW'; reasons.push('both sides normalize to the same non-whitespace text')
    } else if (file.ours.startsWith(file.base) && file.theirs.startsWith(file.base)) {
      kind = 'ADDITIVE'; risk = 'LOW'; reasons.push('both sides append to the base')
    } else {
      reasons.push('overlapping source change requires semantic reasoning')
      if (/price|permission|authorize|billing|payment|security/i.test(file.path + file.ours + file.theirs)) {
        risk = 'HIGH'; reasons.push('security or business-rule terms raise risk')
      }
    }

    return { kind, risk, classifier: this.name, modelVersion: this.version, reasons }
  }

  private onlyImportsChanged(file: ConflictFile): boolean {
    const changed = (text: string) => text.split('\n').filter(line => line.trim() && !file.base.includes(line))
    const lines = [...changed(file.ours), ...changed(file.theirs)]
    return lines.length > 0 && lines.every(line => /^\s*(import|export .* from|use |#include|require\()/.test(line))
  }

  private isWhitespaceOnly(file: ConflictFile): boolean {
    const compact = (value: string) => value.replace(/\s/g, '')
    return compact(file.ours) === compact(file.theirs) && file.ours !== file.theirs
  }
}

/** Adapter boundary for a future Jev client. No Jev SDK is assumed by the example. */
export class JevClassifier implements ConflictClassifier {
  readonly name = 'jev'

  constructor(
    readonly version: string,
    private readonly infer: (input: { path: string; base: string; ours: string; theirs: string }) => Promise<{ kind: ConflictKind; risk: Risk; reasons: string[] }>,
  ) {}

  async classify(file: ConflictFile): Promise<Classification> {
    const result = await this.infer({ path: file.path, base: file.base, ours: file.ours, theirs: file.theirs })
    return { ...result, classifier: this.name, modelVersion: this.version }
  }
}
