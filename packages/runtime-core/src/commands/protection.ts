import type { Entity } from '../types/blueprint.js'
import type { RequestContext } from '../routing/request-ports.js'
import { ProtectedFieldMutationError } from '../errors/domain-errors.js'

const issuedAuthorities = new WeakSet<object>()

export interface CommandMutationAuthority {
  readonly command: string
  readonly entity: string
}

export function issueCommandMutationAuthority(command: string, entity: string): CommandMutationAuthority {
  const authority = Object.freeze({ command, entity })
  issuedAuthorities.add(authority)
  return authority
}

export function assertProtectedMutation(
  entity: Entity | undefined,
  data: Record<string, unknown>,
  context?: RequestContext,
): void {
  if (!entity) return
  const supplied = new Set(Object.keys(data))
  const protectedFields = new Map<string, string[] | undefined>()

  for (const field of entity.fields) {
    if (field.write === 'command-only') protectedFields.set(field.name, field.commands)
  }
  for (const fieldName of entity.protection?.fields ?? []) {
    protectedFields.set(fieldName, entity.protection?.commands)
  }

  const attempted = [...protectedFields.keys()].filter(field => supplied.has(field))
  if (attempted.length === 0) return

  const authority = context?.commandMutation
  const allowed = authority != null
    && issuedAuthorities.has(authority)
    && authority.entity === entity.name
    && attempted.every(field => {
      const commands = protectedFields.get(field)
      return !commands || commands.length === 0 || commands.includes(authority.command)
    })

  if (!allowed) throw new ProtectedFieldMutationError(entity.name, attempted)
}
