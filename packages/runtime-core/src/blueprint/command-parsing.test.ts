import { describe, expect, it } from 'vitest'
import { BlueprintParser, BlueprintValidationError } from './loader.js'

const base = `
version = "1"

[project]
name = "Command Test"
version = "0.6.0"

[project.runtime]
min_version = "0.6.0"

[entity.Request]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "status", type = "Enum", values = ["pending", "approved"], write = "command-only", commands = ["ApproveRequest"] },
  { name = "approvedAt", type = "DateTime", write = "command-only", commands = ["ApproveRequest"] }
]

[entity.Request.protection]
fields = ["status"]
commands = ["ApproveRequest"]

[command.ApproveRequest]
entity = "Request"
description = "Approve a pending request"
policy = "record.status == 'pending'"

[command.ApproveRequest.input.comment]
type = "Text"
required = false

[command.ApproveRequest.mutations]
status = "approved"
approvedAt = "now"
`

describe('command blueprint parsing', () => {
  it('parses commands and protected fields from TOML', () => {
    const blueprint = new BlueprintParser().parse(base, 'toml')
    expect(blueprint.commands).toEqual([expect.objectContaining({
      name: 'ApproveRequest',
      entity: 'Request',
      input: { comment: { type: 'Text', required: false } },
      mutations: { status: 'approved', approvedAt: 'now' },
    })])
    expect(blueprint.entities[0]?.protection).toEqual({
      fields: ['status'],
      commands: ['ApproveRequest'],
    })
  })

  it('rejects protection that names an unknown command', () => {
    expect(() => new BlueprintParser().parse(
      base.replace('commands = ["ApproveRequest"]\n\n[command.ApproveRequest]', 'commands = ["MissingCommand"]\n\n[command.ApproveRequest]'),
      'toml',
    )).toThrow(BlueprintValidationError)
  })

  it('rejects an invalid policy expression during blueprint parsing', () => {
    expect(() => new BlueprintParser().parse(
      base.replace("record.status == 'pending'", "record.status = 'pending'"),
      'toml',
    )).toThrow(BlueprintValidationError)
  })
})
