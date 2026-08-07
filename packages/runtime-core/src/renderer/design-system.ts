import type { DesignSystemConfig } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import { escapeHtmlAttr } from '../security/html-escape.js'

export const DESIGN_SYSTEM_NAMES = ['modern', 'classic', 'friendly', 'minimal'] as const
export type BuiltinDesignSystemName = typeof DESIGN_SYSTEM_NAMES[number]

export const SEMANTIC_DESIGN_TOKENS = [
  'color-primary',
  'color-primary-text',
  'color-success',
  'color-warning',
  'surface-default',
  'surface-card',
  'surface-dialog',
  'text-primary',
  'text-secondary',
  'text-on-primary',
  'border-default',
  'spacing-small',
  'spacing-medium',
  'radius-small',
  'font-family-body',
  'font-family-heading',
  'font-family-mono',
  'font-size-small',
  'font-size-body',
  'font-size-heading-small',
  'font-size-heading-medium',
  'font-size-heading-large',
  'font-weight-normal',
  'font-weight-medium',
  'font-weight-heading',
  'line-height-body',
  'line-height-heading',
] as const

export type SemanticDesignToken = typeof SEMANTIC_DESIGN_TOKENS[number]

export interface ResolvedDesignSystem {
  name: string
  base?: BuiltinDesignSystemName
  tokens: Record<string, string>
  stylesheets: string[]
  css: string
}

const RESET_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--zb-surface-default);color:var(--zb-text-primary)}
button,input,select,textarea{font:inherit}
`

const COMPONENT_CSS = `
.zb-body{background:var(--zb-surface-default);color:var(--zb-text-primary);font-family:var(--zb-font-family-body);font-size:var(--zb-font-size-body);font-weight:var(--zb-font-weight-normal);line-height:var(--zb-line-height-body)}
.zb-nav,.zb-surface-card,[data-zb-surface="card"],.zb-card{background:var(--zb-surface-card);border-color:var(--zb-border-default);border-radius:var(--zb-radius-small)}
.zb-surface-dialog,[data-zb-surface="dialog"],.zb-dialog{background:var(--zb-surface-dialog);border-color:var(--zb-border-default);border-radius:var(--zb-radius-small)}
.zb-text-primary,.zb-heading{color:var(--zb-text-primary)}
.zb-heading{font-family:var(--zb-font-family-heading);font-weight:var(--zb-font-weight-heading);line-height:var(--zb-line-height-heading)}
.zb-heading-large{font-size:var(--zb-font-size-heading-large)}
.zb-heading-medium{font-size:var(--zb-font-size-heading-medium)}
.zb-heading-small{font-size:var(--zb-font-size-heading-small)}
.zb-text-secondary{color:var(--zb-text-secondary)}
.zb-button-primary,[data-zebric-role="primary-action"]{background:var(--zb-color-primary);border-color:var(--zb-color-primary);border-radius:var(--zb-radius-small);color:var(--zb-text-on-primary);font-weight:var(--zb-font-weight-medium)}
.zb-button-primary:hover,[data-zebric-role="primary-action"]:hover{background:var(--zb-color-primary);filter:brightness(.9)}
.zb-button-secondary{background:var(--zb-surface-card);border-color:var(--zb-border-default);border-radius:var(--zb-radius-small);color:var(--zb-text-primary);font-weight:var(--zb-font-weight-medium)}
.zb-link-primary,.zb-link-primary:hover{color:var(--zb-color-primary-text)}
.zb-link-secondary{color:var(--zb-text-secondary)}
.zb-table{border-color:var(--zb-border-default)}
.zb-table-header{background:var(--zb-surface-default);color:var(--zb-text-secondary);font-size:var(--zb-font-size-small);font-weight:var(--zb-font-weight-medium)}
.zb-table-row,.zb-table-cell{border-color:var(--zb-border-default)}
.zb-table-cell{color:var(--zb-text-primary)}
.zb-form{background:var(--zb-surface-card);border-color:var(--zb-border-default);border-radius:var(--zb-radius-small)}
.zb-label{color:var(--zb-text-primary);font-size:var(--zb-font-size-small);font-weight:var(--zb-font-weight-medium)}
.zb-control{background:var(--zb-surface-card);border-color:var(--zb-border-default);border-radius:var(--zb-radius-small);color:var(--zb-text-primary);font-family:var(--zb-font-family-body);font-size:var(--zb-font-size-body);line-height:var(--zb-line-height-body)}
.zb-code{font-family:var(--zb-font-family-mono)}
.zb-control:focus{border-color:var(--zb-color-primary-text);outline:2px solid var(--zb-color-primary-text);outline-offset:1px}
.zb-state-success,[data-zebric-role="status-positive"]{color:var(--zb-color-success)}
.zb-state-warning,[data-zebric-role="status-warning"]{color:var(--zb-color-warning)}
`

const THEME_SEMANTIC_CLASSES: Partial<Record<keyof Theme, string>> = {
  body: 'zb-body',
  heading1: 'zb-heading zb-heading-large',
  heading2: 'zb-heading zb-heading-medium',
  heading3: 'zb-heading zb-heading-small',
  textPrimary: 'zb-text-primary', textSecondary: 'zb-text-secondary',
  nav: 'zb-nav', navBrand: 'zb-text-primary', navLink: 'zb-link-secondary',
  card: 'zb-surface-card',
  buttonPrimary: 'zb-button-primary', buttonSecondary: 'zb-button-secondary',
  linkPrimary: 'zb-link-primary', linkSecondary: 'zb-link-secondary',
  table: 'zb-table', tableHeader: 'zb-table-header', tableRow: 'zb-table-row', tableCell: 'zb-table-cell',
  form: 'zb-form', label: 'zb-label', input: 'zb-control', textarea: 'zb-control', select: 'zb-control', fileInput: 'zb-control',
  errorState: 'zb-state-warning',
}

/** Add stable semantic classes while preserving a renderer's existing utility classes. */
export function withDesignSystemTheme(theme: Theme): Theme {
  const result = { ...theme }
  for (const [key, semanticClass] of Object.entries(THEME_SEMANTIC_CLASSES)) {
    const themeKey = key as keyof Theme
    const value = result[themeKey]
    if (typeof value === 'string' && semanticClass) {
      const existingClasses = new Set(value.split(/\s+/))
      const missingClasses = semanticClass.split(/\s+/).filter(className => !existingClasses.has(className))
      if (missingClasses.length > 0) {
        ;(result as unknown as Record<string, string>)[themeKey] = `${value} ${missingClasses.join(' ')}`
      }
    }
  }
  return result
}

const BUILTIN_TOKENS: Record<BuiltinDesignSystemName, Record<SemanticDesignToken, string>> = {
  modern: {
    'color-primary': '#171717',
    'color-primary-text': '#171717',
    'color-success': '#15803d',
    'color-warning': '#b45309',
    'surface-default': '#fafafa',
    'surface-card': '#ffffff',
    'surface-dialog': '#ffffff',
    'text-primary': '#171717',
    'text-secondary': '#737373',
    'text-on-primary': '#ffffff',
    'border-default': '#e5e5e5',
    'spacing-small': '0.5rem',
    'spacing-medium': '1rem',
    'radius-small': '0.375rem',
    'font-family-body': 'Inter, ui-sans-serif, system-ui, sans-serif',
    'font-family-heading': 'Inter, ui-sans-serif, system-ui, sans-serif',
    'font-family-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    'font-size-small': '0.8125rem',
    'font-size-body': '0.9375rem',
    'font-size-heading-small': '1.125rem',
    'font-size-heading-medium': '1.5rem',
    'font-size-heading-large': '2rem',
    'font-weight-normal': '400',
    'font-weight-medium': '500',
    'font-weight-heading': '600',
    'line-height-body': '1.5',
    'line-height-heading': '1.2',
  },
  classic: {
    'color-primary': '#1e3a5f',
    'color-primary-text': '#1e3a5f',
    'color-success': '#2f6b3c',
    'color-warning': '#9a6700',
    'surface-default': '#f5f1e8',
    'surface-card': '#fffdf7',
    'surface-dialog': '#fffdf7',
    'text-primary': '#28231d',
    'text-secondary': '#675f54',
    'text-on-primary': '#ffffff',
    'border-default': '#cfc5b5',
    'spacing-small': '0.5rem',
    'spacing-medium': '1rem',
    'radius-small': '0.125rem',
    'font-family-body': 'Georgia, Cambria, "Times New Roman", serif',
    'font-family-heading': 'Georgia, Cambria, "Times New Roman", serif',
    'font-family-mono': '"Courier New", Courier, monospace',
    'font-size-small': '0.8125rem',
    'font-size-body': '1rem',
    'font-size-heading-small': '1.25rem',
    'font-size-heading-medium': '1.625rem',
    'font-size-heading-large': '2.25rem',
    'font-weight-normal': '400',
    'font-weight-medium': '600',
    'font-weight-heading': '700',
    'line-height-body': '1.65',
    'line-height-heading': '1.15',
  },
  friendly: {
    'color-primary': '#6d4aff',
    'color-primary-text': '#6d4aff',
    'color-success': '#12764e',
    'color-warning': '#a84a09',
    'surface-default': '#fff9f2',
    'surface-card': '#ffffff',
    'surface-dialog': '#ffffff',
    'text-primary': '#302a3a',
    'text-secondary': '#756d80',
    'text-on-primary': '#ffffff',
    'border-default': '#e8dff0',
    'spacing-small': '0.625rem',
    'spacing-medium': '1.125rem',
    'radius-small': '0.75rem',
    'font-family-body': 'ui-rounded, "Nunito Sans", system-ui, sans-serif',
    'font-family-heading': 'ui-rounded, "Nunito Sans", system-ui, sans-serif',
    'font-family-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    'font-size-small': '0.875rem',
    'font-size-body': '1rem',
    'font-size-heading-small': '1.25rem',
    'font-size-heading-medium': '1.625rem',
    'font-size-heading-large': '2.125rem',
    'font-weight-normal': '400',
    'font-weight-medium': '600',
    'font-weight-heading': '700',
    'line-height-body': '1.6',
    'line-height-heading': '1.2',
  },
  minimal: {
    'color-primary': '#000000',
    'color-primary-text': '#000000',
    'color-success': '#18794e',
    'color-warning': '#ad5700',
    'surface-default': '#ffffff',
    'surface-card': '#ffffff',
    'surface-dialog': '#ffffff',
    'text-primary': '#111111',
    'text-secondary': '#666666',
    'text-on-primary': '#ffffff',
    'border-default': '#d4d4d4',
    'spacing-small': '0.5rem',
    'spacing-medium': '1rem',
    'radius-small': '0',
    'font-family-body': 'Arial, Helvetica, ui-sans-serif, sans-serif',
    'font-family-heading': 'Arial, Helvetica, ui-sans-serif, sans-serif',
    'font-family-mono': 'ui-monospace, SFMono-Regular, monospace',
    'font-size-small': '0.75rem',
    'font-size-body': '0.875rem',
    'font-size-heading-small': '1rem',
    'font-size-heading-medium': '1.25rem',
    'font-size-heading-large': '1.75rem',
    'font-weight-normal': '400',
    'font-weight-medium': '500',
    'font-weight-heading': '500',
    'line-height-body': '1.45',
    'line-height-heading': '1.15',
  },
}

/**
 * Dark-mode overrides for each built-in, keeping the system's identity
 * (hue, warmth) while re-tuning lightness for WCAG AA contrast on dark
 * surfaces. Only tokens that change between light and dark are listed;
 * everything else (spacing, radius, typography) carries over unchanged.
 *
 * `color-primary` stays dark/saturated enough to pair with `text-on-primary`
 * on filled buttons. `color-primary-text` is a separate, brighter shade used
 * for links and focus rings on top of a dark surface — the two can't share
 * one value once the surface itself goes dark (a color dark enough to hold
 * white button text is too dark to read as body-sized text on a near-black
 * page).
 */
const BUILTIN_DARK_TOKENS: Record<BuiltinDesignSystemName, Partial<Record<SemanticDesignToken, string>>> = {
  modern: {
    'color-primary': '#e5e5e5',
    'color-primary-text': '#e5e5e5',
    'text-on-primary': '#171717',
    'color-success': '#4ade80',
    'color-warning': '#fbbf24',
    'surface-default': '#0a0a0a',
    'surface-card': '#171717',
    'surface-dialog': '#171717',
    'text-primary': '#f5f5f5',
    'text-secondary': '#a3a3a3',
    'border-default': '#616161',
  },
  classic: {
    'color-primary': '#2c4d7a',
    'color-primary-text': '#8fb4e3',
    'text-on-primary': '#ffffff',
    'color-success': '#6fbf73',
    'color-warning': '#e0a94c',
    'surface-default': '#1c1815',
    'surface-card': '#262019',
    'surface-dialog': '#262019',
    'text-primary': '#f0ead9',
    'text-secondary': '#b3a890',
    'border-default': '#71675a',
  },
  friendly: {
    'color-primary': '#5636cc',
    'color-primary-text': '#b8a4ff',
    'text-on-primary': '#ffffff',
    'color-success': '#4fd8a0',
    'color-warning': '#ffa552',
    'surface-default': '#1a1625',
    'surface-card': '#241d33',
    'surface-dialog': '#241d33',
    'text-primary': '#f3eefc',
    'text-secondary': '#b3a7c7',
    'border-default': '#6f6290',
  },
  minimal: {
    'color-primary': '#ffffff',
    'color-primary-text': '#ffffff',
    'text-on-primary': '#000000',
    'color-success': '#4ade80',
    'color-warning': '#fbbf24',
    'surface-default': '#000000',
    'surface-card': '#0d0d0d',
    'surface-dialog': '#0d0d0d',
    'text-primary': '#ffffff',
    'text-secondary': '#a3a3a3',
    'border-default': '#5c5c5c',
  },
}

/** Best-effort dark palette for custom systems that don't extend a built-in. */
const FALLBACK_DARK_TOKENS: Partial<Record<SemanticDesignToken, string>> = {
  'surface-default': '#111827',
  'surface-card': '#1f2937',
  'surface-dialog': '#1f2937',
  'text-primary': '#f3f4f6',
  'text-secondary': '#9ca3af',
  'border-default': '#374151',
}

function safeDesignSystemName(name: string): string | undefined {
  return /^[a-zA-Z0-9_-]+$/.test(name) ? name : undefined
}

function renderDarkModeTokens(name: string, base: BuiltinDesignSystemName | undefined): string {
  const overrides = base ? BUILTIN_DARK_TOKENS[base] : FALLBACK_DARK_TOKENS
  const declarations = Object.entries(overrides)
    .map(([token, value]) => `--zb-${token}:${value}`)
    .join(';')

  const safeName = safeDesignSystemName(name)
  const selector = safeName
    ? `html[data-zebric-design-system="${safeName}"][data-zebric-resolved-color-mode="dark"]`
    : `html[data-zebric-resolved-color-mode="dark"]`

  return `${selector}{color-scheme:dark;${declarations}}`
}

function isBuiltin(name: string): name is BuiltinDesignSystemName {
  return DESIGN_SYSTEM_NAMES.includes(name as BuiltinDesignSystemName)
}

function safeTokenName(name: string): string | undefined {
  const normalized = name.startsWith('--zb-') ? name.slice(5) : name
  return /^[a-z][a-z0-9-]*$/.test(normalized) ? normalized : undefined
}

function safeTokenValue(value: string): string {
  return value
    .replace(/[{};<>]/g, '')
    .replace(/(?:javascript|expression)\s*[:(]/gi, '')
    .trim()
}

function safeStylesheetHref(href: string): string | undefined {
  const trimmed = href.trim()
  return trimmed && !/^(?:javascript|data):/i.test(trimmed) ? trimmed : undefined
}

function renderTokens(tokens: Record<string, string>): string {
  const declarations = Object.entries(tokens)
    .map(([name, value]) => {
      const safeName = safeTokenName(name)
      const safeValue = safeTokenValue(value)
      return safeName && safeValue ? `--zb-${safeName}:${safeValue}` : ''
    })
    .filter(Boolean)
    .join(';')

  return declarations ? `:root{${declarations}}` : ''
}

/**
 * Resolve a blueprint design system. `modern` is the default. A custom system
 * inherits only when `extends` names one of Zebric's built-ins.
 */
export function resolveDesignSystem(config?: DesignSystemConfig): ResolvedDesignSystem {
  const selectedName = config?.name ?? 'modern'
  const requestedBase = config?.extends ?? (isBuiltin(selectedName) ? selectedName : undefined)
  const base = requestedBase && isBuiltin(requestedBase) ? requestedBase : undefined
  const tokens = {
    ...(base ? BUILTIN_TOKENS[base] : {}),
    ...(config?.tokens ?? {}),
  }

  return {
    name: selectedName,
    base,
    tokens,
    stylesheets: config?.css ?? [],
    css: `${RESET_CSS}${renderTokens(tokens)}${COMPONENT_CSS}${renderDarkModeTokens(selectedName, base)}`,
  }
}

export function renderDesignSystemStyles(configOrSystem?: DesignSystemConfig | ResolvedDesignSystem): string {
  const system = typeof configOrSystem?.css === 'string'
    ? configOrSystem as ResolvedDesignSystem
    : resolveDesignSystem(configOrSystem as DesignSystemConfig | undefined)
  const links = system.stylesheets
    .map(safeStylesheetHref)
    .filter((href): href is string => Boolean(href))
    .map(href => `<link rel="stylesheet" href="${escapeHtmlAttr(href)}" data-zebric-design-system="${escapeHtmlAttr(system.name)}">`)
    .join('\n')

  return `${links}${links ? '\n' : ''}<style id="zebric-design-system" data-name="${escapeHtmlAttr(system.name)}">${system.css}</style>`
}
