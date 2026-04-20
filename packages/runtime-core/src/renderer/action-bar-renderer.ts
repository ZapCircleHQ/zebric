/**
 * Action Bar Renderer
 *
 * Standalone functions for rendering action bars on detail pages.
 */

import type { Blueprint, Page } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { html, SafeHtml, safe } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'
import { renderPrimaryAction, renderSecondaryAction } from './action-button-renderer.js'
import { getStatusRoleClass, getStatusSemanticRole } from './semantic-role-resolver.js'

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
  blueprint?: Blueprint
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
  const statusRole = hasStatus ? getStatusSemanticRole(statusValue) : null
  const statusClass = statusRole ? getStatusRoleClass(statusRole) : ''

  const primaryActions = (config.actions || []).map(action =>
    renderPrimaryAction(action, record, entity, page, csrfToken, theme, utils, blueprint)
  )
  const secondaryActions = (config.secondaryActions || []).map(action =>
    renderSecondaryAction(action, record, entity, page, csrfToken, theme, utils, blueprint)
  )

  const hasPrimary = primaryActions.length > 0
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
      class="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 ${stickyFooter ? 'sticky bottom-0 z-10 shadow-sm' : ''}"
      data-zebric-primitive="footer-actions"
      data-zebric-action-position="${stickyFooter ? 'sticky-footer' : 'inline'}"
    >
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        ${hasHeader ? html`
          <div class="space-y-2">
            ${config.title ? html`<p class="text-sm font-semibold text-gray-900">${config.title}</p>` : ''}
            ${hasStatus ? html`
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-500">
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
