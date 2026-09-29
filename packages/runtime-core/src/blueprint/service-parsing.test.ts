import { describe, expect, it } from 'vitest'
import { BlueprintParser, BlueprintValidationError } from './loader.js'

const blueprint = `
version = "1"

[project]
name = "Services"
version = "0.6.0"

[project.runtime]
min_version = "0.6.0"

[entity.Lead]
fields = [{ name = "id", type = "ULID", primary_key = true }]

[services.places]
plugin = "google-places"

[services.places.operations.search.input.query]
type = "Text"
required = true

[services.places.operations.search.result]
type = "Object"

[services.places.operations.search.result.fields.count]
type = "Integer"
required = true

[services.places.operations.search.transform]
count = "$result.count"

[workflow.EnrichLead]
trigger = { manual = true }
steps = [{ type = "service", service = "places", operation = "search", params = { query = "coffee" }, assignTo = "matches" }]
`

describe('service blueprint parsing', () => {
  it('parses typed service operations and workflow references', () => {
    const parsed = new BlueprintParser().parse(blueprint, 'toml')
    expect(parsed.services).toEqual([expect.objectContaining({
      name: 'places',
      plugin: 'google-places',
      operations: expect.objectContaining({ search: expect.any(Object) }),
    })])
  })

  it('rejects an unknown service operation in a workflow', () => {
    expect(() => new BlueprintParser().parse(
      blueprint.replace('operation = "search"', 'operation = "missing"'),
      'toml',
    )).toThrow(BlueprintValidationError)
  })
})
