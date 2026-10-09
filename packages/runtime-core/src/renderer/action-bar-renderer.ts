/**
 * Action Bar Renderer
 *
 * Standalone functions for rendering action bars on detail pages.
 */

import type { Blueprint, Command, CommandInputField, Page } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { html, SafeHtml, safe, attr } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'
import { isActionEnabled, isActionVisible, renderPrimaryAction, renderSecondaryAction } from './action-button-renderer.js'
import { getActionButtonClass, getActionSemanticRole, getStatusRoleClass, getStatusSemanticRole } from './semantic-role-resolver.js'
import { commandOperationId } from '../api/openapi-generator.js'

export function getStatusFieldName(config: Page['actionBar'], entity?: any): string | null {
  if (!config) return null
  if (config.showStatus === false) return null
  if (config.statusField) return config.statusField
  const hasStatusField = entity?.fields?.some((field: any) => field.name === 'status')
  return hasStatusField ? 'status' : null
}

export function getFieldType(entity: any, fieldName?: string | null): string {
  if (!entity || !fieldName) {
    return 'Text'
  }
  const field = entity.fields?.find((f: any) => f.name === fieldName)
  return field?.type || 'Text'
}

/**
 * Render action bar for detail pages
 */
export function renderActionBar(
  page: Page,
  record: any,
  theme: Theme,
  utils: RendererUtils,
  entity?: any,
  csrfToken?: string,
  blueprint?: Blueprint,
  availableCommands: string[] = [],
): SafeHtml {
  const config = page.actionBar ?? {}

  const statusField = page.actionBar ? getStatusFieldName(config, entity) : null
  const statusValue = statusField ? record?.[statusField] : undefined
  const hasStatus =
    statusField &&
    statusValue !== undefined &&
    statusValue !== null &&
    statusValue !== ''
  const statusRole = hasStatus ? getStatusSemanticRole(statusValue) : null
  const statusClass = statusRole ? getStatusRoleClass(statusRole) : ''

  const primaryActions = (config.actions || [])
    .filter(action => isActionVisible(action, record))
    .map(action =>
      renderPrimaryAction(action, record, entity, page, csrfToken, theme, utils, blueprint, {
        disabled: !isActionEnabled(action, record),
      })
    )
  const secondaryActions = (config.secondaryActions || [])
    .filter(action => isActionVisible(action, record))
    .map(action =>
      renderSecondaryAction(action, record, entity, page, csrfToken, theme, utils, blueprint, {
        disabled: !isActionEnabled(action, record),
      })
    )
  const commandNames = new Set(availableCommands)
  const commandActions = (blueprint?.commands ?? [])
    .filter(command => command.entity === entity?.name && commandNames.has(command.name))
    .map(command => renderCommandAction(command, record, page, csrfToken, theme, utils, blueprint))

  const hasPrimary = primaryActions.length > 0 || commandActions.length > 0
  const hasSecondary = secondaryActions.length > 0
  const hasHeader = Boolean(config.title || config.description || hasStatus)
  const shouldRender = hasHeader || hasPrimary || hasSecondary
  const stickyFooter =
    page?.ux?.interaction?.primary_action_position === 'sticky-footer'

  if (!shouldRender) {
    return safe('')
  }

  return html`
    <div
      class="mb-6 rounded-lg border zb-border zb-surface-muted px-4 py-4 ${stickyFooter ? 'sticky bottom-0 z-10 shadow-sm' : ''}"
      data-zebric-primitive="footer-actions"
      data-zebric-action-position="${stickyFooter ? 'sticky-footer' : 'inline'}"
    >
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        ${hasHeader ? html`
          <div class="space-y-2">
            ${config.title ? html`<p class="text-sm font-semibold zb-text-primary">${config.title}</p>` : ''}
            ${hasStatus ? html`
              <div class="flex items-center gap-2 text-sm">
                <span class="zb-text-secondary">
                  ${config.statusLabel || (statusField ? utils.formatFieldName(statusField) : '')}
                </span>
                <span
                  class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusClass}"
                  data-zebric-role="${statusRole || 'status-neutral'}"
                >
                  ${utils.formatValue(statusValue, getFieldType(entity, statusField))}
                </span>
              </div>
            ` : ''}
            ${config.description ? html`
              <p class="text-sm zb-text-secondary max-w-prose">${config.description}</p>
            ` : ''}
          </div>
        ` : ''}

        ${hasPrimary ? html`
          <div class="flex flex-wrap gap-2">
            ${safe(primaryActions.map(action => action.html).join(''))}
            ${safe(commandActions.map(action => action.html).join(''))}
          </div>
        ` : ''}
      </div>

      ${hasSecondary ? html`
        <div class="mt-3 flex flex-wrap gap-4 text-sm zb-text-secondary">
          ${safe(secondaryActions.map(action => action.html).join(''))}
        </div>
      ` : ''}
    </div>
  `
}

function renderCommandAction(
  command: Command,
  record: Record<string, unknown>,
  page: Page,
  csrfToken: string | undefined,
  theme: Theme,
  utils: RendererUtils,
  blueprint?: Blueprint,
): SafeHtml {
  const operation = commandOperationId(command.name)
  const action = `/commands/${encodeURIComponent(operation)}/${encodeURIComponent(String(record.id ?? ''))}`
  const redirect = utils.interpolatePath(page.path, record)
  const label = command.label ?? utils.formatFieldName(command.name)
  const buttonClass = getActionButtonClass(command.style, theme, blueprint)
  const semanticRole = getActionSemanticRole(command.style)
  const confirm = command.confirm
    ? safe(attr('onclick', `return confirm(${JSON.stringify(command.confirm)})`))
    : safe('')
  const description = command.description ? safe(attr('title', command.description)) : safe('')
  const fields = Object.entries(command.input ?? {})
  const hidden = html`
    ${csrfToken ? html`<input type="hidden" name="_csrf" value="${csrfToken}" />` : ''}
    <input type="hidden" name="redirect" value="${redirect}" />
  `

  if (fields.length === 0) {
    return html`
      <form method="POST" action="${action}" class="inline">
        ${hidden}
        <button type="submit" class="${buttonClass}" data-zebric-role="${semanticRole}"${description}${confirm}>${label}</button>
      </form>
    `
  }

  return html`
    <details class="relative rounded-lg border zb-border zb-surface-card p-3">
      <summary class="cursor-pointer list-none ${buttonClass}" data-zebric-role="${semanticRole}"${description}>${label}</summary>
      <form method="POST" action="${action}" class="mt-4 min-w-72 space-y-4">
        ${hidden}
        ${command.description ? html`<p class="text-sm zb-text-secondary">${command.description}</p>` : ''}
        ${safe(fields.map(([name, field]) => renderCommandInput(operation, name, field, utils).html).join(''))}
        <button type="submit" class="${buttonClass}" data-zebric-role="${semanticRole}"${confirm}>${label}</button>
      </form>
    </details>
  `
}

function renderCommandInput(
  operation: string,
  name: string,
  field: CommandInputField,
  utils: RendererUtils,
): SafeHtml {
  const id = `command-${operation}-${name}`
  const label = field.label ?? utils.formatFieldName(name)
  const descriptionId = field.description ? `${id}-description` : undefined
  const common = safe(
    `${field.required ? attr('required', true) : ''}${descriptionId ? attr('aria-describedby', descriptionId) : ''}`
  )
  let control: SafeHtml
  if (field.type === 'Enum') {
    control = html`
      <select id="${id}" name="${name}" class="zb-control mt-1 w-full rounded-md border px-3 py-2"${common}>
        ${field.required ? '' : html`<option value="">Select…</option>`}
        ${safe((field.values ?? []).map(value => html`<option value="${value}">${value}</option>`.html).join(''))}
      </select>
    `
  } else if (field.type === 'Boolean') {
    control = html`
      <select id="${id}" name="${name}" class="zb-control mt-1 w-full rounded-md border px-3 py-2"${common}>
        ${field.required ? '' : html`<option value="">Select…</option>`}
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    `
  } else if (field.type === 'LongText' || field.type === 'JSON') {
    control = html`<textarea id="${id}" name="${name}" rows="3" class="zb-control mt-1 w-full rounded-md border px-3 py-2"${common}></textarea>`
  } else {
    const inputType = field.type === 'Integer' || field.type === 'Float'
      ? 'number'
      : field.type === 'Email'
        ? 'email'
        : field.type === 'Date'
          ? 'date'
          : field.type === 'DateTime'
            ? 'datetime-local'
            : 'text'
    const step = field.type === 'Float' ? safe(attr('step', 'any')) : safe('')
    control = html`<input id="${id}" name="${name}" type="${inputType}"${step} class="zb-control mt-1 w-full rounded-md border px-3 py-2"${common} />`
  }
  return html`
    <div>
      <label for="${id}" class="zb-label block text-sm font-medium">${label}</label>
      ${control}
      ${field.description ? html`<p id="${descriptionId}" class="mt-1 text-xs zb-text-secondary">${field.description}</p>` : ''}
    </div>
  `
}
