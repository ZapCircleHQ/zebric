import type { Blueprint, SemanticUIRole } from '../types/blueprint.js'
import type { Theme } from './theme.js'

export type StatusSemanticRole =
  | 'status-positive'
  | 'status-warning'
  | 'status-negative'
  | 'status-neutral'

export function getActionSemanticRole(variant: string | undefined): SemanticUIRole {
  switch (variant) {
    case 'danger':
      return 'destructive-action'
    case 'secondary':
    case 'ghost':
      return 'secondary-action'
    default:
      return 'primary-action'
  }
}

export function getActionButtonClass(
  variant: string | undefined,
  theme: Theme,
  blueprint?: Blueprint
): string {
  const role = getActionSemanticRole(variant)
  const mappedThemeKey = blueprint?.design_adapter?.roles?.[role]
  const mappedClass = mappedThemeKey
    ? (theme as unknown as Record<string, string>)[mappedThemeKey]
    : undefined
  if (mappedClass) {
    return mappedClass
  }

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

export function getStatusSemanticRole(statusValue: unknown): StatusSemanticRole {
  const normalized = String(statusValue || '').toLowerCase()
  if (['approved', 'done', 'complete', 'completed', 'success', 'active'].includes(normalized)) {
    return 'status-positive'
  }
  if (['new', 'triage', 'pending', 'awaiting_approval', 'in_progress', 'open'].includes(normalized)) {
    return 'status-warning'
  }
  if (['rejected', 'failed', 'error', 'blocked', 'cancelled', 'canceled'].includes(normalized)) {
    return 'status-negative'
  }
  return 'status-neutral'
}

export function getStatusRoleClass(role: StatusSemanticRole): string {
  switch (role) {
    case 'status-positive':
      return 'bg-green-50 text-green-700'
    case 'status-warning':
      return 'bg-yellow-50 text-yellow-800'
    case 'status-negative':
      return 'bg-red-50 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}
