import { describe, expect, it } from 'vitest'
import { PermissionManager } from './permissions.js'

const session = (role: string, roles?: unknown[]) => ({
  user: { id: 'user-1', email: 'user@example.test', role, roles },
} as any)
const context = (userSession: any, data?: Record<string, any>) => ({
  session: userSession, entity: 'Document', action: 'update' as const, data,
})

describe('PermissionManager security semantics', () => {
  it('applies an explicit deny across all assigned roles', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      editor: { allow: ['Document.update'] },
      suspended: { allow: ['Document.update'], deny: ['Document.update'] },
    } })
    expect(await manager.checkPermission(context(session('editor', ['suspended'])))).toBe(false)
  })

  it('evaluates current-user conditions against the authenticated session', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      member: { allow: [{ entity: 'Document', actions: ['update'], condition: { '$currentUser.role': 'admin' } }] },
      admin: { allow: [{ entity: 'Document', actions: ['update'], condition: { '$currentUser.role': 'admin' } }] },
    } })
    expect(await manager.checkPermission(context(session('member'), { '$currentUser.role': 'admin' }))).toBe(false)
    expect(await manager.checkPermission(context(session('admin')))).toBe(true)
  })

  it('supports conditional anonymous permissions', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      anonymous: { allow: [{ entity: 'Document', actions: ['update'], condition: { published: true } }] },
    } })
    expect(await manager.checkPermission(context(null, { published: true }))).toBe(true)
    expect(await manager.checkPermission(context(null, { published: false }))).toBe(false)
  })

  it('fails closed for malformed permission patterns', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      member: { allow: ['Document.update.extra', 'Document.invalid'] },
    } })
    expect(await manager.checkPermission(context(session('member')))).toBe(false)
  })

  it('does not grant when condition values or record fields are missing', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      member: { allow: [{ entity: 'Document', actions: ['update'], condition: { ownerId: '$currentUser.missing' } }] },
    } })
    expect(await manager.checkPermission(context(session('member'), {}))).toBe(false)
  })

  it('treats empty conditions as deny', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      member: { allow: [{ entity: 'Document', actions: ['update'], condition: {} }] },
    } })
    expect(await manager.checkPermission(context(session('member'), {}))).toBe(false)
  })

  it('ignores non-string entries in custom-provider role arrays', async () => {
    const manager = new PermissionManager({ providers: [], permissions: {
      admin: { allow: ['*.*'] }, member: { allow: [] },
    } })
    expect(await manager.checkPermission(context(session('member', [{ toString: () => 'admin' }])))).toBe(false)
  })
})
