export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  correlationId?: string
  requestId?: string
  executionId?: string
  workflowName?: string
  pluginName?: string
  route?: string
  entity?: string
  operation?: string
  [key: string]: unknown
}

export interface LogRecord {
  timestamp: string
  level: LogLevel
  message: string
  context: LogContext
}

export interface Logger {
  child(context: LogContext): Logger
  log(level: LogLevel, message: string, context?: LogContext): void
  trace(message: string, context?: LogContext): void
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext & { error?: unknown }): void
}

export interface LoggerTransport {
  write(record: LogRecord): void
}

export interface LoggerOptions {
  level?: LogLevel
  context?: LogContext
  redactKeys?: string[]
  serviceName?: string
  environment?: string
  transport?: LoggerTransport
}

export interface RequestLogContext extends LogContext {
  method: string
  path: string
}

export interface RequestLoggingOptions {
  correlationHeaderName?: string
  requestIdHeaderName?: string
  generateRequestId?: boolean
  logStart?: boolean
  logEnd?: boolean
}
