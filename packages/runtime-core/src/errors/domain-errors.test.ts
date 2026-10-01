import { describe, expect, it } from 'vitest'
import {
  AuthorizationFailureError,
  CommandUnavailableError,
  DomainError,
  ExpressionEvaluationError,
  ExternalResultValidationError,
  ProtectedFieldMutationError,
  ServiceFailureError,
  ValidationFailureError,
  WorkflowFailureError,
} from './domain-errors.js'

describe('domain error model', () => {
  it.each([
    [new ValidationFailureError('invalid'), 'VALIDATION_FAILED'],
    [new AuthorizationFailureError('denied'), 'AUTHORIZATION_FAILED'],
    [new CommandUnavailableError('unavailable'), 'COMMAND_UNAVAILABLE'],
    [new ProtectedFieldMutationError('Request', ['status']), 'PROTECTED_FIELD_MUTATION'],
    [new WorkflowFailureError('failed'), 'WORKFLOW_FAILED'],
    [new ServiceFailureError('failed'), 'SERVICE_FAILED'],
    [new ExpressionEvaluationError('failed'), 'EXPRESSION_EVALUATION_FAILED'],
    [new ExternalResultValidationError('failed'), 'EXTERNAL_RESULT_VALIDATION_FAILED'],
  ])('represents %s with stable code %s', (error, code) => {
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code, message: expect.any(String) })
  })

  it('preserves structured details and causal errors', () => {
    const cause = new Error('provider timed out')
    const error = new ServiceFailureError('service failed', { service: 'places' }, { cause })
    expect(error.details).toEqual({ service: 'places' })
    expect(error.cause).toBe(cause)
  })
})
