/**
 * Form Renderers
 *
 * Standalone form field and input rendering functions.
 */

import type { Theme } from './theme.js'
import { escapeHtml, escapeHtmlAttr } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'

/**
 * Get appropriate autocomplete attribute based on field name and type
 */
function getAutocompleteAttribute(fieldName: string, _fieldType?: string): string {
  const name = fieldName.toLowerCase()

  // Common autocomplete mappings
  const autocompleteMap: Record<string, string> = {
    'email': 'email',
    'username': 'username',
    'password': 'current-password',
    'new-password': 'new-password',
    'new_password': 'new-password',
    'confirm-password': 'new-password',
    'confirm_password': 'new-password',
    'name': 'name',
    'first-name': 'given-name',
    'firstname': 'given-name',
    'first_name': 'given-name',
    'last-name': 'family-name',
    'lastname': 'family-name',
    'last_name': 'family-name',
    'phone': 'tel',
    'telephone': 'tel',
    'mobile': 'tel',
    'address': 'street-address',
    'street': 'street-address',
    'city': 'address-level2',
    'state': 'address-level1',
    'zip': 'postal-code',
    'zipcode': 'postal-code',
    'postal-code': 'postal-code',
    'postal_code': 'postal-code',
    'country': 'country-name',
    'cc-number': 'cc-number',
    'cc-name': 'cc-name',
    'cc-exp': 'cc-exp',
    'cc-csc': 'cc-csc',
    'organization': 'organization',
    'company': 'organization',
    'url': 'url',
    'website': 'url',
    'birthday': 'bday',
    'birthdate': 'bday',
    'birth_date': 'bday'
  }

  const autocompleteValue = autocompleteMap[name]
  return autocompleteValue ? `autocomplete="${autocompleteValue}"` : ''
}

/**
 * Render form input element
 */
export function renderInput(field: any, value: any, theme: Theme, errorId?: string): string {
  const fieldName = escapeHtmlAttr(field.name)
  const fieldPattern = field.pattern ? `pattern="${escapeHtmlAttr(field.pattern)}"` : ''
  const required = field.required ? 'required' : ''
  const ariaInvalid = errorId ? 'aria-invalid="true"' : ''
  const ariaDescribedBy = errorId ? `aria-describedby="${errorId}"` : ''
  const autocomplete = getAutocompleteAttribute(field.name, field.type)
  const baseAttrs = `id="${fieldName}" name="${fieldName}" ${required} ${fieldPattern} ${ariaInvalid} ${ariaDescribedBy} ${autocomplete}`.trim()

  switch (field.type) {
    case 'textarea':
      return `
        <textarea
          ${baseAttrs}
          rows="${escapeHtmlAttr(field.rows || 4)}"
          placeholder="${escapeHtmlAttr(field.placeholder || '')}"
          class="${theme.textarea}"
        >${escapeHtml(value)}</textarea>
      `

    case 'select':
      {
        const selectedValue = value === undefined || value === null ? '' : String(value)
        const options = Array.isArray(field.options) ? field.options : []
        const optionHtml = options.map((opt: any) => {
          const isObjectOption = typeof opt === 'object' && opt !== null
          const rawValue = isObjectOption ? (opt.value ?? opt.label ?? '') : opt
          const rawLabel = isObjectOption ? (opt.label ?? opt.value ?? '') : opt
          const optionValue = rawValue === undefined || rawValue === null ? '' : String(rawValue)
          const optionLabel = rawLabel === undefined || rawLabel === null ? '' : String(rawLabel)
          const isSelected = selectedValue === optionValue

          return `
            <option value="${escapeHtmlAttr(optionValue)}" ${isSelected ? 'selected' : ''}>
              ${escapeHtml(optionLabel)}
            </option>
          `
        }).join('')

      return `
        <select ${baseAttrs} class="${theme.select}">
          ${optionHtml}
        </select>
      `
      }

    case 'checkbox':
      return `
        <input
          type="checkbox"
          ${baseAttrs}
          ${value ? 'checked' : ''}
          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      `

    case 'file':
      return `
        <input
          type="file"
          ${baseAttrs}
          accept="${escapeHtmlAttr(field.accept?.join(',') || '')}"
          class="${theme.fileInput}"
        />
      `

    case 'date':
      return `
        <input
          type="date"
          ${baseAttrs}
          value="${escapeHtmlAttr(value)}"
          class="${theme.input}"
        />
      `

    case 'number':
      return `
        <input
          type="number"
          ${baseAttrs}
          value="${escapeHtmlAttr(value)}"
          min="${escapeHtmlAttr(field.min || '')}"
          max="${escapeHtmlAttr(field.max || '')}"
          step="${escapeHtmlAttr(field.step || '')}"
          class="${theme.input}"
        />
      `

    default:
      return `
        <input
          type="${escapeHtmlAttr(field.type || 'text')}"
          ${baseAttrs}
          value="${escapeHtmlAttr(value)}"
          placeholder="${escapeHtmlAttr(field.placeholder || '')}"
          class="${theme.input}"
        />
      `
  }
}

/**
 * Render form field with label, input, and error message
 */
export function renderFormField(field: any, theme: Theme, utils: RendererUtils, record?: any): string {
  const value = record?.[field.name] || field.default || ''
  const fieldName = escapeHtmlAttr(field.name)
  const fieldLabel = escapeHtml(field.label || utils.formatFieldName(field.name))
  const errorMsg = escapeHtml(field.error_message || '')
  const errorId = `${fieldName}-error`
  const hasError = !!field.error_message

  return `
    <div class="${theme.formField}">
      <label for="${fieldName}" class="${theme.label}">
        ${fieldLabel}
        ${field.required ? '<span class="text-red-500" aria-label="required">*</span>' : ''}
      </label>

      ${renderInput(field, value, theme, hasError ? errorId : undefined)}

      ${field.error_message ? `
        <p id="${errorId}" class="${theme.fieldError} hidden" data-error="${fieldName}" role="alert">
          ${errorMsg}
        </p>
      ` : ''}
    </div>
  `
}
