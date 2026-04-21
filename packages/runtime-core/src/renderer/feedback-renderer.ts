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
      return 'border-green-300 bg-green-50 text-green-800'
    case 'error':
      return 'border-red-300 bg-red-50 text-red-800'
    case 'warning':
      return 'border-yellow-300 bg-yellow-50 text-yellow-800'
    default:
      return 'border-blue-200 bg-blue-50 text-blue-800'
  }
}
