export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'COMMAND_UNAVAILABLE'
  | 'PROTECTED_FIELD_MUTATION'
  | 'WORKFLOW_FAILED'
  | 'SERVICE_FAILED'
  | 'EXPRESSION_EVALUATION_FAILED'
  | 'EXTERNAL_RESULT_VALIDATION_FAILED'

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class ValidationFailureError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_FAILED', message, details)
  }
}

export class AuthorizationFailureError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('AUTHORIZATION_FAILED', message, details)
  }
}

export class CommandUnavailableError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('COMMAND_UNAVAILABLE', message, details)
  }
}

export class ProtectedFieldMutationError extends DomainError {
  constructor(entity: string, fields: string[]) {
    super(
      'PROTECTED_FIELD_MUTATION',
      `Protected fields on ${entity} may only be changed by an allowed command: ${fields.join(', ')}`,
      { entity, fields },
    )
  }
}

export class WorkflowFailureError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super('WORKFLOW_FAILED', message, details, options)
  }
}

export class ServiceFailureError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super('SERVICE_FAILED', message, details, options)
  }
}

export class ExpressionEvaluationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super('EXPRESSION_EVALUATION_FAILED', message, details, options)
  }
}

export class ExternalResultValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super('EXTERNAL_RESULT_VALIDATION_FAILED', message, details, options)
  }
}
