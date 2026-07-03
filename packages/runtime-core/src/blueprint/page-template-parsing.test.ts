import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'

describe('page template parsing', () => {
  it('retains custom templates and layout slots from TOML', () => {
    const blueprint = new BlueprintParser().parse(`
version = "0.1.0"

[project]
name = "Template test"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[auth]
providers = ["email"]

[auth.pages.signIn]
engine = "liquid"
type = "file"
source = "templates/sign-in.liquid"

[entity.Item]
fields = [{ name = "id", type = "ULID", primary_key = true }]

[page."/"]
title = "Home"
layout = "custom"

[page."/".template]
engine = "liquid"
type = "file"
source = "templates/home.liquid"

[page."/".layoutSlots."dashboard.widgets"]
engine = "liquid"
type = "inline"
source = "<p>Widget</p>"
`, 'toml')

    expect(blueprint.pages[0]?.template).toEqual({
      engine: 'liquid',
      type: 'file',
      source: 'templates/home.liquid',
    })
    expect(blueprint.pages[0]?.layoutSlots?.['dashboard.widgets']).toEqual({
      engine: 'liquid',
      type: 'inline',
      source: '<p>Widget</p>',
    })
    expect(blueprint.auth?.pages?.signIn).toEqual({
      engine: 'liquid',
      type: 'file',
      source: 'templates/sign-in.liquid',
    })
  })
})
