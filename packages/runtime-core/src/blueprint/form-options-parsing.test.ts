import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

const parser = new BlueprintParser()

function blueprintWithForm(field: string, query = `
[page."/items/new".query.themes]
entity = "Theme"
`): string {
  return `
version = "1.0"

[project]
name = "form-options"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Theme]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true }
]

[entity.Item]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "themeId", type = "Ref", ref = "Theme.id", required = true }
]

[page."/items/new"]
title = "New item"
layout = "form"
${query}
[page."/items/new".form]
entity = "Item"
method = "create"

[[page."/items/new".form.fields]]
${field}
`
}

describe('query-backed form options', () => {
  it('parses optionsFrom configuration', () => {
    const blueprint = parser.parse(blueprintWithForm(`
name = "themeId"
type = "select"
optionsFrom = { query = "themes", value = "id", label = "title", emptyLabel = "Select a theme" }
`), 'toml')

    expect(blueprint.pages[0].form?.fields[0].optionsFrom).toEqual({
      query: 'themes',
      value: 'id',
      label: 'title',
      emptyLabel: 'Select a theme',
    })
  })

  it('rejects optionsFrom referencing an unknown page query', () => {
    expect(() => parser.parse(blueprintWithForm(`
name = "themeId"
type = "select"
optionsFrom = { query = "missing", label = "title" }
`, ''), 'toml')).toThrow('references unknown query "missing"')
  })

  it('rejects optionsFrom referencing an unknown entity field', () => {
    expect(() => parser.parse(blueprintWithForm(`
name = "themeId"
type = "select"
optionsFrom = { query = "themes", label = "missing" }
`), 'toml')).toThrow('references unknown field "Theme.missing"')
  })

  it('rejects optionsFrom on non-select fields', () => {
    expect(() => parser.parse(blueprintWithForm(`
name = "themeId"
type = "text"
optionsFrom = { query = "themes", label = "title" }
`), 'toml')).toThrow('uses optionsFrom but is not a select')
  })
})
