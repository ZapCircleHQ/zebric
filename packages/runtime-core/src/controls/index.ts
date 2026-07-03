/**
 * Controls — shared interactive primitives usable at form-field and widget
 * mount points. See controls/types.ts for the overview.
 */

export type { ControlMount, ControlName } from './types.js'

// Lookup control
export { LookupConfigSchema, type LookupConfig } from './lookup/config.js'
export { renderLookup, LOOKUP_STYLES, type LookupRenderOptions } from './lookup/render.js'
export { formatDisplay } from './lookup/format.js'
export {
  handleLookupSearch,
  resolveLookupConfig,
  type LookupSearchParams,
  type LookupSearchDeps,
  type LookupSearchResult,
} from './lookup/handler.js'

/**
 * Control names that can mount as form fields.
 */
export const FORM_MOUNTABLE_CONTROLS = ['lookup'] as const

/**
 * Control names that can mount as page-level widgets.
 */
export const WIDGET_MOUNTABLE_CONTROLS = ['board', 'lookup'] as const

/**
 * Whether a form field type refers to a registered control (vs a built-in
 * primitive like "text" or "number").
 */
export function isFormControl(type: string | undefined): boolean {
  return typeof type === 'string' && (FORM_MOUNTABLE_CONTROLS as readonly string[]).includes(type)
}
