import { describe, expect, it } from 'vitest'
import { BlueprintParser } from './loader.js'
import { McpAppsSchema } from './schema.js'

const view = { name: 'tasks', title: 'Tasks', operation: 'tasks_list', layout: 'table' as const }

describe('MCP App declarations', () => {
  it('preserves TOML declarations in complete blueprints and fragments', () => {
    const app = `[[mcp_apps]]\nname = "tasks"\ntitle = "Tasks"\noperation = "tasks_list"\nlayout = "table"\nfields = ["title", { field = "status", label = "Status" }]`
    const parser = new BlueprintParser()
    const root = `version = "1"\n[project]\nname = "Tasks"\nversion = "1"\n[project.runtime]\nmin_version = "0.9.0"\n${app}`
    expect(parser.parse(root, 'toml').mcp_apps).toEqual([{ ...view, fields: ['title', { field: 'status', label: 'Status' }] }])
    expect(parser.parseFragment(app).mcp_apps?.[0].name).toBe('tasks')
  })

  it('preserves JSON declarations', () => {
    const input = { version: '1', project: { name: 'Tasks', version: '1', runtime: { min_version: '0.9.0' } }, entities: [], pages: [], mcp_apps: [view] }
    expect(new BlueprintParser().parse(JSON.stringify(input), 'json').mcp_apps).toEqual([view])
  })

  it.each([
    [{ ...view, name: '../escape' }],
    [{ ...view, layout: 'iframe' }],
    [{ ...view, resource_uri: 'https://example.com' }],
    [{ ...view, fields: [] }],
    [{ ...view, fields: [{ field: 'status', lable: 'Status' }] }],
    [view, { ...view, operation: 'other' }],
    [view, { ...view, name: 'other' }],
    [view, { ...view, name: 'other', operation: 'other', resource_uri: 'ui://zebric/tasks.html' }],
  ])('rejects invalid or ambiguous declarations: %j', (...views) => {
    expect(McpAppsSchema.safeParse(views).success).toBe(false)
  })

  it('reports a duplicate name once, not again as its derived resource URI', () => {
    const result = McpAppsSchema.safeParse([view, { ...view, operation: 'other' }])
    expect(result.success).toBe(false)
    expect(result.error!.issues.map(issue => issue.message)).toEqual(['Duplicate MCP App name: tasks'])
  })
})
