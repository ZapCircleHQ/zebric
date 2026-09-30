import type { UserSession } from './provider.js'

/** Transport-neutral identity used by authorization, commands, audit and events. */
export interface Actor {
  id: string
  type: 'user' | 'agent' | 'service' | 'system'
  roles: string[]
  scopes: string[]
  credentialId?: string
  delegatedBy?: string
  metadata?: Record<string, unknown>
}

export function actorFromSession(session?: UserSession | null): Actor | null {
  if (!session?.user) return null
  const declaredRoles = Array.isArray(session.actor?.roles) ? session.actor.roles : []
  const userRoles = Array.isArray(session.user.roles) ? session.user.roles : []
  const singleRole = typeof session.user.role === 'string' ? [session.user.role] : []
  const roles = [...new Set([...declaredRoles, ...userRoles, ...singleRole])]
  if (roles.length === 0 && (!session.actor || session.actor.type === 'user')) roles.push('user')
  return {
    id: session.actor?.id ?? session.user.id,
    type: session.actor?.type ?? 'user',
    roles,
    scopes: [...new Set(session.actor?.scopes ?? [])],
    credentialId: session.actor?.credentialId,
    delegatedBy: session.actor?.delegatedBy,
    metadata: {
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      ...session.actor?.metadata,
    },
  }
}

export function sessionWithActor(session: UserSession | null | undefined, actor: Actor): UserSession {
  const delegatedUserId = actor.delegatedBy ?? session?.user.id ?? actor.id
  return {
    id: session?.id ?? `actor:${actor.type}:${actor.id}`,
    userId: delegatedUserId,
    user: {
      ...(session?.user ?? {}),
      id: delegatedUserId,
      email: session?.user.email ?? `${delegatedUserId}@actor.zebric.internal`,
      roles: actor.roles,
    },
    expiresAt: session?.expiresAt ?? new Date('9999-12-31T23:59:59.000Z'),
    createdAt: session?.createdAt ?? new Date(),
    actor: { ...actor },
  }
}
