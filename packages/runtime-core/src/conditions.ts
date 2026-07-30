export type Condition = Record<string, any>

export function getConditionValue(source: any, path: string): any {
  if (source == null) {
    return undefined
  }

  if (Object.prototype.hasOwnProperty.call(source, path)) {
    return source[path]
  }

  let current = source
  for (const part of path.split('.')) {
    if (current == null) {
      return undefined
    }
    current = current[part]
  }

  return current
}

export function evaluateCondition(condition: Condition | undefined, source: any): boolean {
  if (!condition || Object.keys(condition).length === 0) {
    return true
  }

  for (const [key, expected] of Object.entries(condition)) {
    if (key === '$and') {
      return Array.isArray(expected) && expected.every((entry) => evaluateCondition(entry, source))
    }

    if (key === '$or') {
      return Array.isArray(expected) && expected.some((entry) => evaluateCondition(entry, source))
    }

    const actual = getConditionValue(source, key)
    if (!matchesExpectedValue(actual, expected)) {
      return false
    }
  }

  return true
}

function matchesExpectedValue(actual: any, expected: any): boolean {
  if (Array.isArray(expected)) {
    return expected.includes(actual)
  }

  if (expected && typeof expected === 'object') {
    // A missing/unresolved value never satisfies an operator comparison -
    // otherwise `$ne` (and similar) would vacuously match when the source
    // record couldn't be loaded, e.g. undefined !== 'archived' is true.
    if (actual === undefined) {
      return false
    }

    for (const [operator, operand] of Object.entries(expected)) {
      const value = operand as any
      switch (operator) {
        case '$eq':
          if (actual !== value) return false
          break
        case '$ne':
          if (actual === value) return false
          break
        case '$gt':
          if (!(actual > value)) return false
          break
        case '$gte':
          if (!(actual >= value)) return false
          break
        case '$lt':
          if (!(actual < value)) return false
          break
        case '$lte':
          if (!(actual <= value)) return false
          break
        default:
          throw new Error(`Unknown operator: ${operator}`)
      }
    }
    return true
  }

  return actual === expected
}
