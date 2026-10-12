import type { Blueprint, Page, PageUXConfig } from '../types/blueprint.js'

/** Resolve global defaults, a named pattern, and page overrides field by field. */
export function resolvePageUX(blueprint: Blueprint, page?: Page): PageUXConfig {
  const global = blueprint.ux
  const patternName = page?.ux?.pattern ?? global?.pattern
  const pattern = patternName ? global?.patterns?.[patternName] ?? global?.patterns?.[patternName.split('@')[0]!] : undefined
  return {
    ...pattern, ...page?.ux,
    pattern: patternName,
    interaction: { ...global?.interaction, ...pattern?.interaction, ...page?.ux?.interaction },
    data: { ...global?.data, ...pattern?.data, ...page?.ux?.data },
    form: {
      ...global?.form, ...pattern?.form, ...page?.ux?.form,
      interaction: { ...global?.form?.interaction, ...pattern?.form?.interaction, ...page?.ux?.form?.interaction },
    },
  }
}
