import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

const parser = new BlueprintParser()

function blueprintWithUX(uxToml: string): string {
  return `
version = "1.0"

[project]
name = "zazzle-test"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Issue]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "description", type = "LongText" },
  { name = "status", type = "Enum", values = ["new", "triage", "done"], default = "new" }
]

[page."/issues"]
title = "Issues"
layout = "list"

[page."/issues".query.issues]
entity = "Issue"

[page."/issues/new"]
title = "New Issue"
layout = "form"

[page."/issues/new".form]
entity = "Issue"
method = "create"
mode = "page"

[[page."/issues/new".form.fields]]
name = "title"
type = "text"
label = "Title"

${uxToml}
`
}

describe('Zazzle UX parsing', () => {
  it('parses top-level UX and design adapter config', () => {
    const bp = parser.parse(blueprintWithUX(`
[ux]
pattern = "queue-detail@v1"

[ux.interaction]
selection = "single"
row_click = "open-detail"
edit_mode = "modal"
primary_action_position = "sticky-footer"
confirm_destructive = true

[ux.data]
mode = "table"
density = "compact"
pagination = "server"
filters = "top-bar"
column_config = true

[ux.system.feedback]
success = "toast"
error = "inline"

[ux.system.activity]
timeline = true
location = "side-panel"

[ux.navigation]
model = "sidebar"
primary = ["Dashboard", "Requests"]

[ux.responsive]
mode = "desktop-first"
collapse_sidebar = true

[design_adapter]
name = "default"
version = "1.0"

[design_adapter.roles]
primary-action = "buttonPrimary"
surface-elevated = "card"
`), 'toml')

    expect(bp.ux?.pattern).toBe('queue-detail@v1')
    expect(bp.ux?.interaction?.row_click).toBe('open-detail')
    expect(bp.ux?.data?.density).toBe('compact')
    expect(bp.ux?.system?.feedback?.success).toBe('toast')
    expect(bp.ux?.system?.activity?.location).toBe('side-panel')
    expect(bp.ux?.navigation?.primary).toEqual(['Dashboard', 'Requests'])
    expect(bp.ux?.responsive?.collapse_sidebar).toBe(true)
    expect(bp.design_adapter?.version).toBe('1.0')
    expect(bp.design_adapter?.roles?.['primary-action']).toBe('buttonPrimary')
  })

  it('parses page UX pattern metadata and structured form sections', () => {
    const bp = parser.parse(blueprintWithUX(`
[page."/issues".ux]
pattern = "data-table@v1"
primitives = ["page", "header", "content", "table"]

[page."/issues".ux.interaction]
selection = "single"
row_click = "open-detail"

[page."/issues".ux.roles]
openAction = "primary-action"
status = "status-neutral"

[[page."/issues/new".form.sections]]
title = "Basic Info"
layout = "two-column"

[[page."/issues/new".form.sections.fields]]
name = "title"

[page."/issues/new".form.interaction]
validation = "inline"
save_behavior = "optimistic"
`), 'toml')

    const listPage = bp.pages.find(page => page.path === '/issues')
    const formPage = bp.pages.find(page => page.path === '/issues/new')

    expect(listPage?.ux?.pattern).toBe('data-table@v1')
    expect(listPage?.ux?.primitives).toEqual(['page', 'header', 'content', 'table'])
    expect(listPage?.ux?.roles?.openAction).toBe('primary-action')
    expect(formPage?.form?.sections?.[0]?.title).toBe('Basic Info')
    expect(formPage?.form?.sections?.[0]?.layout).toBe('two-column')
    expect(formPage?.form?.sections?.[0]?.fields).toEqual([{ name: 'title' }])
    expect(formPage?.form?.interaction?.save_behavior).toBe('optimistic')
  })

  it('rejects unsupported UX patterns', () => {
    expect(() => parser.parse(blueprintWithUX(`
[ux]
pattern = "freeform@v1"
`), 'toml')).toThrow('supported UX pattern')
  })
})
