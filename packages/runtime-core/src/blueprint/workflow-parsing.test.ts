import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

describe('workflow parsing from TOML', () => {
  it('preserves retry, timeout, and enabled settings', () => {
    const blueprint = new BlueprintParser().parse(`
version = "1.0"

[project]
name = "workflow-retries"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Item]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "createdAt", type = "DateTime", default = "now" },
  { name = "updatedAt", type = "DateTime", default = "now" }
]

[page."/"]
title = "Items"
layout = "list"

[workflow.UpdateItem]
trigger = { manual = true }
retries = 1
timeout = 2500
enabled = false

[[workflow.UpdateItem.steps]]
type = "query"
entity = "Item"
action = "update"
`, 'toml')

    expect(blueprint.workflows?.[0]).toMatchObject({ retries: 1, timeout: 2500, enabled: false })
  })
})
