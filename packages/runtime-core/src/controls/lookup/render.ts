/**
 * Lookup control — HTML renderer.
 *
 * Produces the same interactive combobox element at both mount points.
 * Form-field mount wraps it in a field row (label + error slot) compatible
 * with the rest of the form. Widget mount wraps it in a page-level container
 * with a title.
 */

import { escapeHtml, escapeHtmlAttr, safe, SafeHtml } from '../../security/html-escape.js'
import type { ControlMount } from '../types.js'
import type { LookupConfig } from './config.js'

export interface LookupRenderOptions {
  mount: ControlMount
  /** For form-field mount: field name, current stored id (if any). */
  fieldName?: string
  currentId?: string
  /** Pre-resolved current label (rendered already for value display). */
  currentLabel?: string
  /** The control config. */
  config: LookupConfig
  /** Page path — used by the client to hit the search endpoint. */
  pagePath: string
  /** For form-field mount: the form field's search lookup key. For widget mount, omitted. */
  field?: string
  /** For widget mount: on-select action (e.g., navigate). */
  onSelect?: Record<string, any>
  /** Optional id for the input — useful for label association. */
  inputId?: string
  /** Optional label (form field passes the field label). */
  label?: string
  /** Optional required flag (form field). */
  required?: boolean
}

export function renderLookup(options: LookupRenderOptions): SafeHtml {
  const {
    mount, fieldName, currentId = '', currentLabel = '',
    config, pagePath, field, onSelect, inputId, label, required,
  } = options

  const id = inputId || `lookup-${fieldName || 'widget'}-${Math.random().toString(36).slice(2, 8)}`
  const listId = `${id}-list`

  const clientConfig = {
    mount,
    pagePath,
    field,
    fieldName,
    placeholder: config.placeholder || 'Search…',
    limit: config.limit ?? 10,
    onSelect: mount === 'widget' ? (onSelect ?? null) : null,
  }

  const comboboxHtml = `
    <div class="control-lookup" data-control="lookup"
         data-control-config="${escapeHtmlAttr(JSON.stringify(clientConfig))}">
      <div class="control-lookup-input-wrap">
        <input type="text"
               id="${escapeHtmlAttr(id)}"
               class="control-lookup-label"
               role="combobox"
               aria-autocomplete="list"
               aria-expanded="false"
               aria-controls="${escapeHtmlAttr(listId)}"
               aria-haspopup="listbox"
               ${required ? 'aria-required="true"' : ''}
               placeholder="${escapeHtmlAttr(config.placeholder || 'Search…')}"
               value="${escapeHtmlAttr(currentLabel)}"
               autocomplete="off" />
        ${mount === 'form-field' ? `
          <input type="hidden"
                 name="${escapeHtmlAttr(fieldName || '')}"
                 class="control-lookup-value"
                 value="${escapeHtmlAttr(currentId)}"
                 ${required ? 'required' : ''} />
        ` : ''}
      </div>
      <ul class="control-lookup-list" id="${escapeHtmlAttr(listId)}"
          role="listbox" hidden></ul>
    </div>
  `

  if (mount === 'form-field') {
    return safe(`
      ${label ? `<label for="${escapeHtmlAttr(id)}" class="control-lookup-field-label">${escapeHtml(label)}${required ? ' *' : ''}</label>` : ''}
      ${comboboxHtml}
    `)
  }

  // widget mount: whole-page
  return safe(`
    <div class="control-lookup-page">
      <header class="control-lookup-page-header">
        <h1>${escapeHtml(label || 'Search')}</h1>
      </header>
      ${comboboxHtml}
    </div>
    ${LOOKUP_STYLES}
  `)
}

export const LOOKUP_STYLES = `<style>
  .control-lookup { position: relative; }
  .control-lookup-input-wrap { display: block; }
  .control-lookup-field-label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
  .control-lookup-label { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.875rem; outline: none; }
  .control-lookup-label:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
  .control-lookup-list { position: absolute; top: 100%; left: 0; right: 0; z-index: 20; list-style: none; margin: 0.25rem 0 0 0; padding: 0.25rem 0; background: white; border: 1px solid #e5e7eb; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-height: 16rem; overflow-y: auto; }
  .control-lookup-list[hidden] { display: none; }
  .control-lookup-item { padding: 0.5rem 0.75rem; font-size: 0.875rem; cursor: pointer; color: #111827; }
  .control-lookup-item[aria-selected="true"], .control-lookup-item:hover { background: #eff6ff; color: #1d4ed8; }
  .control-lookup-empty { padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #6b7280; font-style: italic; }
  .control-lookup-page { max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
  .control-lookup-page-header h1 { font-size: 1.5rem; font-weight: 700; color: #111827; margin: 0 0 1rem 0; }
</style>`
