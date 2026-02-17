/**
 * Form Processor
 *
 * Standalone functions for form validation, execution, and authorization.
 */

import type { Blueprint, Form } from '../types/blueprint.js'
import type { RequestContext, QueryExecutorPort } from './request-ports.js'
import { AccessControl } from '../database/access-control.js'

/**
 * Execute a form action (create, update, delete)
 */
export async function executeFormAction(
  form: Form,
  data: Record<string, any>,
  context: RequestContext,
  queryExecutor?: QueryExecutorPort
): Promise<any> {
  if (!queryExecutor) {
    throw new Error('No query executor available')
  }

  try {
    switch (form.method) {
      case 'create':
        return await queryExecutor.create(form.entity, data, context)

      case 'update':
        const updateId = context.params?.id || data.id
        if (!updateId) {
          throw new Error('No ID provided for update')
        }
        return await queryExecutor.update(form.entity, updateId, data, context)

      case 'delete':
        const deleteId = context.params?.id || data.id
        if (!deleteId) {
          throw new Error('No ID provided for delete')
        }
        await queryExecutor.delete(form.entity, deleteId, context)
        return { id: deleteId, deleted: true }

      default:
        throw new Error(`Unknown form method: ${form.method}`)
    }
  } catch (error) {
    console.error('Form action error:', error)
    throw error
  }
}

/**
 * Validate form data against field definitions
 */
export function validateForm(
  form: Form,
  data: Record<string, any>,
  isUpdate = false
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []

  for (const field of form.fields) {
    const value = data[field.name]

    // For updates, skip required checks on fields not included in the request
    if (isUpdate && value === undefined) {
      continue
    }

    // Required check
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: field.name,
        message: `${field.label || field.name} is required`
      })
    }

    // Pattern check
    if (field.pattern && value) {
      const regex = new RegExp(field.pattern)
      if (!regex.test(value)) {
        errors.push({
          field: field.name,
          message: field.error_message || 'Invalid format'
        })
      }
    }

    // Min/max checks for numbers
    if (field.type === 'number' && value !== undefined && value !== null) {
      if (field.min !== undefined && value < field.min) {
        errors.push({
          field: field.name,
          message: `Must be at least ${field.min}`
        })
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({
          field: field.name,
          message: `Must be at most ${field.max}`
        })
      }
    }
  }

  return errors
}

/**
 * Check if a form action is authorized for the current session
 */
export async function checkFormAuthorization(
  form: Form,
  action: 'create' | 'update' | 'delete',
  data: Record<string, any>,
  session: any,
  blueprint?: Blueprint,
  queryExecutor?: QueryExecutorPort,
  recordId?: string
): Promise<boolean> {
  // Get entity from blueprint
  if (!blueprint?.entities) {
    return false
  }

  const entity = blueprint.entities.find((item: any) => item?.name === form.entity)
  if (!entity || typeof entity !== 'object') {
    return false
  }

  // For update/delete, fetch existing record to check ownership
  if ((action === 'update' || action === 'delete') && recordId && queryExecutor) {
    try {
      const existingRecord = await queryExecutor.findById(form.entity, recordId)
      data = { ...existingRecord, ...data }
    } catch (error) {
      return false
    }
  }

  try {
    const hasAccess = await AccessControl.checkAccess({
      session,
      action,
      entity: entity as any,
      data
    })

    return hasAccess
  } catch (error) {
    console.error('Authorization check error:', error)
    return false
  }
}
