import { describe, expect, it } from 'vitest'
import { BlueprintParser, BlueprintValidationError } from './loader.js'

describe('Blueprint TOML fragments', () => {
  const content = `
imports = ["./nested/entities.toml"]
[design_system]
name = "modern"
`

  it('parses a partial module without requiring root metadata', () => {
    expect(new BlueprintParser().parseFragment(content, 'design-system.toml')).toMatchObject({
      imports: ['./nested/entities.toml'],
      design_system: { name: 'modern' },
    })
  })

  it('does not silently ignore imports in the string-only parser', () => {
    expect(() => new BlueprintParser().parse(content, 'toml', 'blueprint.toml'))
      .toThrow(BlueprintValidationError)
  })
})
