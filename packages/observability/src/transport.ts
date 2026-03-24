import type { LogRecord, LoggerTransport } from './types.js'

export type ConsoleFormat = 'pretty' | 'json'

export interface ConsoleTransportOptions {
  format?: ConsoleFormat
}

function getConsoleMethod(record: LogRecord): (...args: unknown[]) => void {
  switch (record.level) {
    case 'trace':
    case 'debug':
      return console.debug
    case 'info':
      return console.info
    case 'warn':
      return console.warn
    case 'error':
      return console.error
  }
}

function formatPretty(record: LogRecord): string {
  const contextEntries = Object.entries(record.context)
  if (contextEntries.length === 0) {
    return `[${record.level}] ${record.message}`
  }

  const suffix = contextEntries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ')

  return `[${record.level}] ${record.message} ${suffix}`
}

export class ConsoleTransport implements LoggerTransport {
  private readonly format: ConsoleFormat

  constructor(options: ConsoleTransportOptions = {}) {
    this.format = options.format ?? 'pretty'
  }

  write(record: LogRecord): void {
    const output = this.format === 'json'
      ? JSON.stringify(record)
      : formatPretty(record)

    getConsoleMethod(record)(output)
  }
}
