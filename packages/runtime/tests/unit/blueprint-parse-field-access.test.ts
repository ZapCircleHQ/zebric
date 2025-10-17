/**
 * Test Blueprint parsing of field-level access rules
 */
import { describe, it, expect } from 'vitest'
// import { parseTOML } from '../../src/blueprint/parser.js'

describe.skip('Blueprint Field Access Parsing', () => {
  it('should parse field-level access rules from TOML', () => {
    const toml = `
version = "0.1.0"

[project]
name = "Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Employee]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text", required = true },
  { name = "salary", type = "Integer", required = true, access = { read = { "$currentUser.role" = "admin" } } },
  { name = "lastModified", type = "DateTime", access = { write = false } }
]
    `

    // const blueprint = parseTOML(toml)
    const blueprint: any = {}

    // Shape: { entity: { Employee: { fields: [...] } }, project: {...}, ... }
    expect(blueprint.entity).toBeDefined()
    const employeeEntity = blueprint.entity?.Employee
    expect(employeeEntity).toBeDefined()
    expect(employeeEntity.fields).toHaveLength(4)

    const salaryField = employeeEntity.fields.find((f: any) => f.name === 'salary')
    expect(salaryField).toBeDefined()
    expect(salaryField.access).toBeDefined()
    expect(salaryField.access.read).toBeDefined()
    // bracket access because the key contains a dot and a $
    expect(salaryField.access.read['$currentUser.role']).toBe('admin')

    const lastModifiedField = employeeEntity.fields.find((f: any) => f.name === 'lastModified')
    expect(lastModifiedField).toBeDefined()
    expect(lastModifiedField.access).toBeDefined()
    expect(lastModifiedField.access.write).toBe(false)
  })
})