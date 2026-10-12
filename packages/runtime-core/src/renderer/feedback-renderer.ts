import type { Blueprint } from '../types/blueprint.js'
import { escapeHtml, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'
import type { FlashMessage } from '../routing/request-ports.js'

export function renderFlash(blueprint: Blueprint, flash?: FlashMessage): SafeHtml {
  if (!flash || !flash.text) {
    return safe('')
  }

  const feedbackMode = resolveFeedbackMode(blueprint, flash.type)
  const baseClasses = feedbackMode === 'toast'
    ? 'fixed right-4 top-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg'
    : 'mx-auto mb-6 max-w-3xl rounded-lg border px-4 py-3 text-sm'
  const variantClasses = getFlashVariantClasses(flash.type)

  return safe(`
    <div
      role="status"
      aria-live="polite"
      class="${baseClasses} ${variantClasses}"
      data-zebric-feedback="${escapeHtmlAttr(feedbackMode)}"
    >
      ${escapeHtml(flash.text)}
    </div>
  `)
}

export function resolveFeedbackMode(
  blueprint: Blueprint,
  type: FlashMessage['type']
): 'toast' | 'inline' | 'banner' {
  const feedback = blueprint.ux?.system?.feedback
  if (type === 'success') {
    return feedback?.success || 'inline'
  }
  if (type === 'error') {
    return feedback?.error || 'inline'
  }
  return 'inline'
}

export function getFlashVariantClasses(type: FlashMessage['type']): string {
  switch (type) {
    case 'success':
      return 'zb-feedback-success'
    case 'error':
      return 'zb-feedback-error'
    case 'warning':
      return 'zb-feedback-warning'
    default:
      return 'zb-feedback-info'
  }
}
