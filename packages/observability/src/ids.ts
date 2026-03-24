const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

function generateId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}_${value}`
}

export function createCorrelationId(): string {
  return generateId('corr')
}

export function createRequestId(): string {
  return generateId('req')
}

export function createExecutionId(): string {
  return generateId('exec')
}

export function isValidTraceId(value: string): boolean {
  return ID_PATTERN.test(value)
}

export function resolveCorrelationId(
  headers: Headers,
  headerName: string = 'x-correlation-id'
): string {
  const incoming = headers.get(headerName)?.trim()
  if (incoming && isValidTraceId(incoming)) {
    return incoming
  }

  return createCorrelationId()
}
