import type { Blueprint, BuiltinDesignSystemName } from '@zebric/runtime-core'

export const playgroundDesignSystems: ReadonlyArray<{
  name: BuiltinDesignSystemName
  label: string
}> = [
  { name: 'modern', label: 'Modern' },
  { name: 'classic', label: 'Classic' },
  { name: 'friendly', label: 'Friendly' },
  { name: 'minimal', label: 'Minimal' },
]

const names = new Set(playgroundDesignSystems.map(system => system.name))

export function getPlaygroundDesignSystem(blueprint?: Blueprint): BuiltinDesignSystemName {
  const configured = blueprint?.design_system?.name
  return configured && names.has(configured as BuiltinDesignSystemName)
    ? configured as BuiltinDesignSystemName
    : 'modern'
}

export function withPlaygroundDesignSystem(
  blueprint: Blueprint,
  designSystem: BuiltinDesignSystemName
): Blueprint {
  return {
    ...blueprint,
    hash: `${blueprint.hash || 'playground'}:design-system:${designSystem}`,
    design_system: { name: designSystem },
  }
}
