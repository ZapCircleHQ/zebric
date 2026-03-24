const DEFAULT_REDACT_KEYS = [
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'accessToken',
  'refreshToken',
]

function shouldRedact(key: string, redactKeys: string[]): boolean {
  const normalizedKey = key.toLowerCase()
  return redactKeys.some((candidate) => normalizedKey.includes(candidate.toLowerCase()))
}

export function redactValue<T>(value: T, redactKeys: string[] = DEFAULT_REDACT_KEYS): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, redactKeys)) as T
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (shouldRedact(key, redactKeys)) {
      redacted[key] = '[REDACTED]'
      continue
    }

    redacted[key] = redactValue(entry, redactKeys)
  }

  return redacted as T
}

export function getDefaultRedactKeys(): string[] {
  return [...DEFAULT_REDACT_KEYS]
}
