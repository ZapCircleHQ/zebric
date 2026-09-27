import type { CandidateResolution, ConflictFile } from './types.js'

const importLine = /^\s*(import|export .* from|use |#include|const .*require\()/

export function resolveImports(file: ConflictFile): CandidateResolution {
  const baseBody = file.base.split('\n').filter(line => !importLine.test(line))
  const imports = [...file.base.split('\n'), ...file.ours.split('\n'), ...file.theirs.split('\n')]
    .filter(line => importLine.test(line))
  const uniqueImports = [...new Set(imports)].sort((a, b) => a.localeCompare(b))
  return candidate(file, [...uniqueImports, ...baseBody].join('\n'), 'sorted-union-imports', 'Kept a sorted union of imports from base, ours, and theirs.')
}

export function resolveFormatting(file: ConflictFile): CandidateResolution {
  return candidate(file, file.ours, 'prefer-ours-formatting', 'Both versions have equivalent non-whitespace content; kept ours.')
}

export function resolveAdditive(file: ConflictFile): CandidateResolution | undefined {
  const oursSuffix = file.ours.startsWith(file.base) ? file.ours.slice(file.base.length) : undefined
  const theirsSuffix = file.theirs.startsWith(file.base) ? file.theirs.slice(file.base.length) : undefined
  if (oursSuffix === undefined || theirsSuffix === undefined) return undefined
  const content = file.base + oursSuffix + theirsSuffix
  return candidate(file, content, 'append-union', 'Preserved the base and appended independent additions from both sides.')
}

function candidate(file: ConflictFile, content: string, resolver: string, explanation: string): CandidateResolution {
  return { path: file.path, content, source: 'deterministic', resolver, explanation, assumptions: [], requiresHumanReview: false }
}
