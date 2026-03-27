export function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: serializeError(error.cause),
    }
  }

  if (typeof error === 'object') {
    return { ...error as Record<string, unknown> }
  }

  return { message: String(error) }
}
