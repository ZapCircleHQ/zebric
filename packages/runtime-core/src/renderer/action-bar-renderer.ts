/**
 * Action Bar Renderer
 *
 * Standalone functions for rendering action bars on detail pages.
 */

import type { Page, ActionBarAction } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { html, escapeHtmlAttr, SafeHtml, safe, attr } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'

export function getActionButtonClass(variant: string | undefined, theme: Theme): string {
  switch (variant) {
    case 'secondary':
      return theme.buttonSecondary
    case 'danger':
      return `${theme.buttonSecondary} border-red-300 text-red-600 hover:bg-red-50`
    case 'ghost':
      return 'px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg border border-transparent'
    default:
      return theme.buttonPrimary
  }
}

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

export function resolveActionPayload(action: ActionBarAction, record: any, utils: RendererUtils): Record<string, any> | undefined {
  if (!action.payload) {
    return undefined
  }

  const resolved: Record<string, any> = {}
  for (const [key, value] of Object.entries(action.payload)) {
    if (typeof value === 'string') {
      resolved[key] = utils.interpolateText(value, record)
    } else {
      resolved[key] = value
    }
  }

  return resolved
}

export function renderPrimaryAction(
  action: ActionBarAction,
  record: any,
  entity: any,
  page: Page | undefined,
  csrfToken: string | undefined,
  theme: Theme,
  utils: RendererUtils
): SafeHtml {
  if (action.workflow) {
    return renderWorkflowAction(action, record, entity, page, 'primary', csrfToken, theme, utils)
  }

  const method = (action.method || 'GET').toUpperCase()
  const href = action.href ? utils.interpolatePath(action.href, record) : '#'
  const buttonClass = getActionButtonClass(action.style, theme)
  const confirmAttr = action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''

  if (method === 'POST') {
    return html`
      <form method="POST" action="${href}" class="inline" data-enhance="api">
        ${csrfToken ? html`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />` : ''}
        ${action.successMessage ? html`<input type="hidden" name="successMessage" value="${escapeHtmlAttr(action.successMessage)}" />` : ''}
        ${action.errorMessage ? html`<input type="hidden" name="errorMessage" value="${escapeHtmlAttr(action.errorMessage)}" />` : ''}
        <button type="submit" class="${buttonClass}"${confirmAttr}>
          ${action.label}
        </button>
      </form>
    `
  }

  return html`
    <a
      href="${href}"
      class="${buttonClass}"
      ${action.target ? attr('target', action.target) : ''}
      ${action.target === '_blank' ? attr('rel', 'noopener noreferrer') : ''}
      ${confirmAttr}
    >
      ${action.label}
    </a>
  `
}

export function renderSecondaryAction(
  action: ActionBarAction,
  record: any,
  entity: any,
  page: Page | undefined,
  csrfToken: string | undefined,
  theme: Theme,
  utils: RendererUtils
): SafeHtml {
  if (action.workflow) {
    return renderWorkflowAction(action, record, entity, page, 'secondary', csrfToken, theme, utils)
  }

  const href = action.href ? utils.interpolatePath(action.href, record) : '#'
  return html`
    <a
      href="${href}"
      class="${theme.linkSecondary} underline-offset-4 hover:underline"
      ${action.target ? attr('target', action.target) : ''}
      ${action.target === '_blank' ? attr('rel', 'noopener noreferrer') : ''}
      ${action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''}
    >
      ${action.label}
    </a>
  `
}

export function renderWorkflowAction(
  action: ActionBarAction,
  record: any,
  entity: any,
  page: Page | undefined,
  variant: 'primary' | 'secondary',
  csrfToken: string | undefined,
  theme: Theme,
  utils: RendererUtils
): SafeHtml {
  const workflow = action.workflow!
  const payload = resolveActionPayload(action, record, utils)
  const payloadJson = payload ? JSON.stringify(payload) : null
  const buttonClass =
    variant === 'primary'
      ? getActionButtonClass(action.style, theme)
      : `${theme.linkSecondary} underline-offset-4 hover:underline`
  const redirectTarget = action.redirect
    ? utils.interpolatePath(action.redirect, record)
    : (page ? utils.interpolatePath(page.path, record ?? {}) : '')
  const confirmAttr = action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''

  return html`
    <form method="POST" action="/actions/${encodeURIComponent(workflow)}" class="inline" data-enhance="api">
      ${csrfToken ? html`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />` : ''}
      ${entity?.name ? html`<input type="hidden" name="entity" value="${escapeHtmlAttr(entity.name)}" />` : ''}
      ${record?.id ? html`<input type="hidden" name="recordId" value="${escapeHtmlAttr(record.id)}" />` : ''}
      ${page?.path ? html`<input type="hidden" name="page" value="${escapeHtmlAttr(page.path)}" />` : ''}
      ${redirectTarget ? html`<input type="hidden" name="redirect" value="${escapeHtmlAttr(redirectTarget)}" />` : ''}
      ${payloadJson ? html`<input type="hidden" name="payload" value='${escapeHtmlAttr(payloadJson)}' />` : ''}
      ${action.successMessage ? html`<input type="hidden" name="successMessage" value="${escapeHtmlAttr(action.successMessage)}" />` : ''}
      ${action.errorMessage ? html`<input type="hidden" name="errorMessage" value="${escapeHtmlAttr(action.errorMessage)}" />` : ''}
      <button type="submit" class="${buttonClass}"${confirmAttr}>
        ${action.label}
      </button>
    </form>
  `
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
  csrfToken?: string
): SafeHtml {
  const config = page.actionBar
  if (!config) {
    return safe('')
  }

  const statusField = getStatusFieldName(config, entity)
  const statusValue = statusField ? record?.[statusField] : undefined
  const hasStatus =
    statusField &&
    statusValue !== undefined &&
    statusValue !== null &&
    statusValue !== ''

  const primaryActions = (config.actions || []).map(action =>
    renderPrimaryAction(action, record, entity, page, csrfToken, theme, utils)
  )
  const secondaryActions = (config.secondaryActions || []).map(action =>
    renderSecondaryAction(action, record, entity, page, csrfToken, theme, utils)
  )

  const hasPrimary = primaryActions.length > 0
  const hasSecondary = secondaryActions.length > 0
  const hasHeader = Boolean(config.title || config.description || hasStatus)
  const shouldRender = hasHeader || hasPrimary || hasSecondary

  if (!shouldRender) {
    return safe('')
  }

  return html`
    <div class="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        ${hasHeader ? html`
          <div class="space-y-2">
            ${config.title ? html`<p class="text-sm font-semibold text-gray-900">${config.title}</p>` : ''}
            ${hasStatus ? html`
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-500">
                  ${config.statusLabel || (statusField ? utils.formatFieldName(statusField) : '')}
                </span>
                <span class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 capitalize">
                  ${utils.formatValue(statusValue, getFieldType(entity, statusField))}
                </span>
              </div>
            ` : ''}
            ${config.description ? html`
              <p class="text-sm text-gray-600 max-w-prose">${config.description}</p>
            ` : ''}
          </div>
        ` : ''}

        ${hasPrimary ? html`
          <div class="flex flex-wrap gap-2">
            ${safe(primaryActions.map(action => action.html).join(''))}
          </div>
        ` : ''}
      </div>

      ${hasSecondary ? html`
        <div class="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
          ${safe(secondaryActions.map(action => action.html).join(''))}
        </div>
      ` : ''}
    </div>
  `
}
