import { describe, it, expect } from 'vitest'
import { BlueprintParser } from './loader.js'

const parser = new BlueprintParser()

function blueprintWithSkill(skillToml: string): string {
  return `
version = "1.0"

[project]
name = "test-app"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Issue]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true },
  { name = "status", type = "Enum", values = ["new", "open", "closed"], default = "new" },
  { name = "createdAt", type = "DateTime", default = "now" },
  { name = "updatedAt", type = "DateTime", default = "now" }
]

[entity.Comment]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "issueId", type = "Ref", ref = "Issue.id", required = true },
  { name = "body", type = "LongText", required = true },
  { name = "createdAt", type = "DateTime", default = "now" }
]

[page."/"]
title = "Home"
layout = "list"

[page."/issues/:id"]
title = "Issue Detail"
layout = "detail"

[workflow.SetStatus]
trigger = { manual = true }
[[workflow.SetStatus.steps]]
type = "query"
entity = "Issue"
action = "update"

${skillToml}
`
}

describe('skill parsing from TOML', () => {
  it('parses a skill with actions', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "create_issue"
description = "Create a new issue."
method = "POST"
path = "/api/issues"

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.skills).toBeDefined()
    expect(bp.skills).toHaveLength(1)

    const skill = bp.skills![0]
    expect(skill.name).toBe('dispatch')
    expect(skill.description).toBe('Manage issues.')
    expect(skill.actions).toHaveLength(2)

    expect(skill.actions[0].name).toBe('create_issue')
    expect(skill.actions[0].method).toBe('POST')
    expect(skill.actions[0].path).toBe('/api/issues')
    expect(skill.actions[0].description).toBe('Create a new issue.')

    expect(skill.actions[1].name).toBe('get_issue')
    expect(skill.actions[1].method).toBe('GET')
    expect(skill.actions[1].path).toBe('/api/issues/{id}')
  })

  it('parses skill actions with entity and action annotations', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "set_status"
method = "POST"
path = "/api/issues/{id}/status"
body = { status = "Enum" }
entity = "Issue"
action = "update"
`)
    const bp = parser.parse(toml, 'toml')
    const action = bp.skills![0].actions[0]

    expect(action.entity).toBe('Issue')
    expect(action.action).toBe('update')
    expect(action.body).toEqual({ status: 'Enum' })
  })

  it('parses skill actions with mapParams', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "add_comment"
method = "POST"
path = "/api/issues/{id}/comments"
body = { body = "LongText" }
entity = "Comment"
action = "create"
[skill.dispatch.actions.mapParams]
id = "issueId"
`)
    const bp = parser.parse(toml, 'toml')
    const action = bp.skills![0].actions[0]

    expect(action.mapParams).toEqual({ id: 'issueId' })
  })

  it('parses skill actions with workflow reference', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "set_status_wf"
method = "POST"
path = "/api/issues/{id}/status-wf"
workflow = "SetStatus"
entity = "Issue"
`)
    const bp = parser.parse(toml, 'toml')
    const action = bp.skills![0].actions[0]

    expect(action.workflow).toBe('SetStatus')
  })

  it('parses skill with auth = "none"', () => {
    const toml = blueprintWithSkill(`
[skill.public_api]
description = "Public API."
auth = "none"

[[skill.public_api.actions]]
name = "list_issues"
method = "GET"
path = "/api/public/issues"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.skills![0].auth).toBe('none')
  })

  it('defaults auth when not specified', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.skills![0].auth).toBeUndefined()
  })

  it('parses multiple skills', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"

[skill.reporting]
description = "Reporting API."

[[skill.reporting.actions]]
name = "get_report"
method = "GET"
path = "/api/reports"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.skills).toHaveLength(2)
    expect(bp.skills![0].name).toBe('dispatch')
    expect(bp.skills![1].name).toBe('reporting')
  })

  it('allows blueprints without skills', () => {
    const toml = blueprintWithSkill('')
    const bp = parser.parse(toml, 'toml')

    expect(bp.skills).toBeUndefined()
  })
})

describe('skill reference validation', () => {
  it('rejects skill actions referencing unknown entities', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "list_ghosts"
method = "GET"
path = "/api/ghosts"
entity = "Ghost"
action = "list"
`)
    expect(() => parser.parse(toml, 'toml')).toThrow('unknown entity "Ghost"')
  })

  it('rejects skill actions referencing unknown workflows', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "trigger_ghost"
method = "POST"
path = "/api/trigger"
workflow = "NonExistentWorkflow"
`)
    expect(() => parser.parse(toml, 'toml')).toThrow('unknown workflow "NonExistentWorkflow"')
  })

  it('accepts skill actions referencing valid entities', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "list_issues"
method = "GET"
path = "/api/issues"
entity = "Issue"
action = "list"
`)
    expect(() => parser.parse(toml, 'toml')).not.toThrow()
  })

  it('accepts skill actions referencing valid workflows', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "trigger_status"
method = "POST"
path = "/api/trigger-status"
workflow = "SetStatus"
`)
    expect(() => parser.parse(toml, 'toml')).not.toThrow()
  })

  it('accepts skill actions with no entity or workflow refs', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_info"
method = "GET"
path = "/api/info"
`)
    expect(() => parser.parse(toml, 'toml')).not.toThrow()
  })
})

describe('API key config parsing', () => {
  it('parses auth.apiKeys from blueprint', () => {
    const toml = blueprintWithSkill(`
[auth]
providers = ["email"]

[[auth.apiKeys]]
name = "my-agent"
keyEnv = "MY_AGENT_KEY"

[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.auth?.apiKeys).toBeDefined()
    expect(bp.auth!.apiKeys).toHaveLength(1)
    expect(bp.auth!.apiKeys![0].name).toBe('my-agent')
    expect(bp.auth!.apiKeys![0].keyEnv).toBe('MY_AGENT_KEY')
  })

  it('parses multiple API keys', () => {
    const toml = blueprintWithSkill(`
[auth]
providers = ["email"]

[[auth.apiKeys]]
name = "agent-a"
keyEnv = "AGENT_A_KEY"

[[auth.apiKeys]]
name = "agent-b"
keyEnv = "AGENT_B_KEY"

[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.auth!.apiKeys).toHaveLength(2)
    expect(bp.auth!.apiKeys![0].name).toBe('agent-a')
    expect(bp.auth!.apiKeys![1].name).toBe('agent-b')
  })

  it('allows auth without apiKeys', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    const bp = parser.parse(toml, 'toml')

    expect(bp.auth?.apiKeys).toBeUndefined()
  })
})

describe('skill schema validation', () => {
  it('rejects invalid HTTP method', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "bad_method"
method = "PATCH"
path = "/api/issues"
`)
    expect(() => parser.parse(toml, 'toml')).toThrow()
  })

  it('rejects invalid action type', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."

[[skill.dispatch.actions]]
name = "bad_action"
method = "POST"
path = "/api/issues"
entity = "Issue"
action = "upsert"
`)
    expect(() => parser.parse(toml, 'toml')).toThrow()
  })

  it('rejects invalid auth value', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."
auth = "public"

[[skill.dispatch.actions]]
name = "get_issue"
method = "GET"
path = "/api/issues/{id}"
`)
    expect(() => parser.parse(toml, 'toml')).toThrow()
  })

  it('rejects skill with missing actions array', () => {
    const toml = blueprintWithSkill(`
[skill.dispatch]
description = "Manage issues."
`)
    expect(() => parser.parse(toml, 'toml')).toThrow()
  })
})
