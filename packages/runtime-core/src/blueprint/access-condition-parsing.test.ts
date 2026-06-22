import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

describe('access condition parsing', () => {
  it('accepts shorthand conditions inside entity rules and compound row access', () => {
    const blueprint = new BlueprintParser().parse(`
version = "0.1.0"
[project]
name = "Access test"
version = "0.1.0"
[project.runtime]
min_version = "0.1.0"

[entity.Item]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "visibility", type = "Text" }
]

[entity.Item.access]
read = { or = [{ visibility = "public" }, "authenticated"] }
create = "authenticated"
update = "owner"
delete = false

[page."/"]
title = "Items"
layout = "list"
[page."/".query.items]
entity = "Item"
`, 'toml')

    expect(blueprint.entities[0]?.access).toEqual({
      read: { or: [{ visibility: 'public' }, 'authenticated'] },
      create: 'authenticated',
      update: 'owner',
      delete: false,
    })
  })
})
