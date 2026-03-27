import { serializeError } from './errors.js'
import { getDefaultRedactKeys, redactValue } from './redaction.js'
import { ConsoleTransport } from './transport.js'
import type {
  LogContext,
  LogLevel,
  LogRecord,
  Logger,
  LoggerOptions,
  LoggerTransport,
} from './types.js'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

function normalizeContext(
  baseContext: LogContext,
  nextContext: LogContext | undefined,
  redactKeys: string[]
): LogContext {
  return redactValue({
    ...baseContext,
    ...nextContext,
  }, redactKeys)
}

class DefaultLogger implements Logger {
  private readonly level: LogLevel
  private readonly context: LogContext
  private readonly redactKeys: string[]
  private readonly transport: LoggerTransport

  constructor(options: Required<Pick<LoggerOptions, 'level' | 'context' | 'transport'>> & { redactKeys: string[] }) {
    this.level = options.level
    this.context = options.context
    this.redactKeys = options.redactKeys
    this.transport = options.transport
  }

  child(context: LogContext): Logger {
    return new DefaultLogger({
      level: this.level,
      context: {
        ...this.context,
        ...context,
      },
      redactKeys: this.redactKeys,
      transport: this.transport,
    })
  }

  log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) {
      return
    }

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: normalizeContext(this.context, context, this.redactKeys),
    }

    this.transport.write(record)
  }

  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context)
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: LogContext & { error?: unknown }): void {
    const errorContext = context?.error
      ? {
          ...context,
          error: serializeError(context.error),
        }
      : context

    this.log('error', message, errorContext)
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const context: LogContext = {
    serviceName: options.serviceName,
    environment: options.environment,
    ...options.context,
  }

  return new DefaultLogger({
    level: options.level ?? 'info',
    context,
    redactKeys: options.redactKeys ?? getDefaultRedactKeys(),
    transport: options.transport ?? new ConsoleTransport(),
  })
}
