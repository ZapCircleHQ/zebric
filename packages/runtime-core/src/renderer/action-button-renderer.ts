import type { Blueprint, Page, ActionBarAction } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { html, escapeHtmlAttr, SafeHtml, attr } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'
import { getActionButtonClass, getActionSemanticRole } from './semantic-role-resolver.js'

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
  utils: RendererUtils,
  blueprint?: Blueprint
): SafeHtml {
  if (action.workflow) {
    return renderWorkflowAction(action, record, entity, page, 'primary', csrfToken, theme, utils, blueprint)
  }

  const method = (action.method || 'GET').toUpperCase()
  const href = action.href ? utils.interpolatePath(action.href, record) : '#'
  const buttonClass = getActionButtonClass(action.style, theme, blueprint)
  const semanticRole = getActionSemanticRole(action.style)
  const confirmAttr = action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''

  if (method === 'POST') {
    return html`
      <form method="POST" action="${href}" class="inline" data-enhance="api">
        ${csrfToken ? html`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />` : ''}
        ${action.successMessage ? html`<input type="hidden" name="successMessage" value="${escapeHtmlAttr(action.successMessage)}" />` : ''}
        ${action.errorMessage ? html`<input type="hidden" name="errorMessage" value="${escapeHtmlAttr(action.errorMessage)}" />` : ''}
        <button type="submit" class="${buttonClass}" data-zebric-role="${semanticRole}"${confirmAttr}>
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
      data-zebric-role="${semanticRole}"
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
  utils: RendererUtils,
  blueprint?: Blueprint
): SafeHtml {
  if (action.workflow) {
    return renderWorkflowAction(action, record, entity, page, 'secondary', csrfToken, theme, utils, blueprint)
  }

  const href = action.href ? utils.interpolatePath(action.href, record) : '#'
  return html`
    <a
      href="${href}"
      class="${theme.linkSecondary} underline-offset-4 hover:underline"
      ${action.target ? attr('target', action.target) : ''}
      ${action.target === '_blank' ? attr('rel', 'noopener noreferrer') : ''}
      ${action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''}
      data-zebric-role="secondary-action"
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
  utils: RendererUtils,
  blueprint?: Blueprint
): SafeHtml {
  const workflow = action.workflow!
  const payload = resolveActionPayload(action, record, utils)
  const payloadJson = payload ? JSON.stringify(payload) : null
  const buttonClass =
    variant === 'primary'
      ? getActionButtonClass(action.style, theme, blueprint)
      : `${theme.linkSecondary} underline-offset-4 hover:underline`
  const semanticRole = variant === 'primary'
    ? getActionSemanticRole(action.style)
    : 'secondary-action'
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
      <button type="submit" class="${buttonClass}" data-zebric-role="${semanticRole}"${confirmAttr}>
        ${action.label}
      </button>
    </form>
  `
}
