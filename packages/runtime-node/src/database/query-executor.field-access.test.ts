import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { SYSTEM_SESSION } from '@zebric/runtime-core'
import { DatabaseConnection } from './connection.js'
import { QueryExecutor } from './query-executor.js'

const authed = { user: { id: 'user-1', name: 'User One', email: 'u1@example.test', role: 'member' } } as any
const admin = { user: { id: 'admin-1', name: 'Admin', email: 'a@example.test', role: 'admin' } } as any

const blueprint: Blueprint = {
  version: '0.1.0',
  hash: 'field-access-test',
  project: { name: 'Field access test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
  entities: [{
    name: 'Doc',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text', required: true },
      { name: 'body', type: 'LongText' },
      // Hard-protected: no client, agent, or UI write is ever accepted.
      { name: 'assigneeId', type: 'Text', access: { write: false } },
      // Conditionally writable: only an authenticated principal may set it.
      { name: 'region', type: 'Text', access: { write: 'authenticated' } },
      // Admin-only, expressed as an object condition on the session.
      { name: 'ownerNote', type: 'Text', access: { write: { '$currentUser.role': 'admin' } } },
      // No write rule, but read is denied -> "cannot write what you cannot read".
      { name: 'secret', type: 'Text', access: { read: false } },
      // Server-managed owner pointer: not client-writable, auto-filled from session.
      { name: 'createdById', type: 'Ref', ref: 'User.id', access: { write: false } },
      { name: 'createdAt', type: 'DateTime', default: 'now' },
      { name: 'updatedAt', type: 'DateTime', default: 'now' },
    ],
    access: { read: true, create: true, update: true, delete: true },
  }],
  pages: [],
}

describe('QueryExecutor field-level write access', () => {
  let connection: DatabaseConnection
  let executor: QueryExecutor

  beforeEach(async () => {
    connection = new DatabaseConnection({ type: 'sqlite', filename: ':memory:' }, blueprint)
    await connection.connect()
    executor = new QueryExecutor(connection)
  })

  afterEach(async () => {
    await connection.close()
  })

  describe('create', () => {
    it('drops a hard-protected field but still creates the record', async () => {
      const created = await executor.create('Doc', {
        title: 'Roadmap', body: 'draft', assigneeId: 'user-999',
      }, { session: authed })

      expect(created.title).toBe('Roadmap')
      expect(created.body).toBe('draft')
      expect(created.assigneeId ?? null).toBeNull()
    })

    it('drops a field the caller cannot write for lack of a satisfied condition', async () => {
      const anon = await executor.create('Doc', { title: 'Anon doc', region: 'eu', ownerNote: 'sneaky' })
      expect(anon.region ?? null).toBeNull()
      expect(anon.ownerNote ?? null).toBeNull()

      const asMember = await executor.create('Doc', { title: 'Member doc', region: 'eu', ownerNote: 'sneaky' }, { session: authed })
      expect(asMember.region).toBe('eu') // 'authenticated' satisfied
      expect(asMember.ownerNote ?? null).toBeNull() // admin-only, member denied

      const asAdmin = await executor.create('Doc', { title: 'Admin doc', ownerNote: 'ok' }, { session: admin })
      expect(asAdmin.ownerNote).toBe('ok')
    })

    it('drops a field whose read access is denied (no explicit write rule)', async () => {
      const created = await executor.create('Doc', { title: 'Has secret', secret: 'leak' }, { session: admin })
      expect(created.secret ?? null).toBeNull()
    })

    it('ignores a client-supplied owner pointer and auto-fills it from the session', async () => {
      const created = await executor.create('Doc', {
        title: 'Owned', createdById: 'user-999',
      }, { session: authed })
      expect(created.createdById).toBe('user-1')
    })

    it('lets a trusted system session write protected fields', async () => {
      const created = await executor.create('Doc', {
        title: 'Workflow doc', assigneeId: 'user-7', region: 'apac', ownerNote: 'system set',
      }, { session: SYSTEM_SESSION })

      expect(created.assigneeId).toBe('user-7')
      expect(created.region).toBe('apac')
      expect(created.ownerNote).toBe('system set')
    })

    it('leaves unprotected fields and entity-level access checks untouched', async () => {
      const restricted: Blueprint = structuredClone(blueprint)
      restricted.entities[0]!.access = { ...restricted.entities[0]!.access, create: 'authenticated' }
      const conn = new DatabaseConnection({ type: 'sqlite', filename: ':memory:' }, restricted)
      await conn.connect()
      const exec = new QueryExecutor(conn)
      await expect(exec.create('Doc', { title: 'nope' })).rejects.toThrow('Access denied')
      await conn.close()
    })
  })

  describe('update', () => {
    let docId: string

    beforeEach(async () => {
      const created = await executor.create('Doc', {
        title: 'Original', body: 'v1',
      }, { session: SYSTEM_SESSION })
      // System-seed a protected value we can assert is preserved.
      await executor.update('Doc', created.id, { assigneeId: 'user-3', region: 'us' }, { session: SYSTEM_SESSION })
      docId = created.id
    })

    it('preserves a hard-protected field while applying the rest of the patch', async () => {
      const updated = await executor.update('Doc', docId, {
        title: 'Renamed', body: 'v2', assigneeId: 'attacker',
      }, { session: authed })

      expect(updated.title).toBe('Renamed')
      expect(updated.body).toBe('v2')
      expect(updated.assigneeId).toBe('user-3')
    })

    it('applies an authenticated-writable field but drops an admin-only one for a member', async () => {
      const updated = await executor.update('Doc', docId, {
        title: 'Edited', region: 'eu', ownerNote: 'member edit',
      }, { session: authed })

      expect(updated.title).toBe('Edited')
      expect(updated.region).toBe('eu') // 'authenticated' write rule -> member may set region
      expect(updated.ownerNote ?? null).toBeNull() // admin-only -> stripped
    })

    it('lets a trusted system session change protected fields', async () => {
      const updated = await executor.update('Doc', docId, { assigneeId: 'user-9' }, { session: SYSTEM_SESSION })
      expect(updated.assigneeId).toBe('user-9')
    })

    it('strips protected fields on the atomic updateWhere path too', async () => {
      const updated = await executor.updateWhere(
        'Doc', docId, { title: 'Original' },
        { title: 'Atomic', assigneeId: 'attacker' },
        { session: authed },
      )
      expect(updated.title).toBe('Atomic')
      expect(updated.assigneeId).toBe('user-3')
    })

    it('does not apply a stripped protected value even when it is the only field supplied', async () => {
      const updated = await executor.update('Doc', docId, { assigneeId: 'attacker' }, { session: authed })
      expect(updated.assigneeId).toBe('user-3')
    })
  })
})
