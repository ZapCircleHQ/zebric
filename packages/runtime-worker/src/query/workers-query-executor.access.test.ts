/**
 * Access-control coverage for the Workers (D1) query executor: entity-level
 * create/update/delete rules and blueprint field-level `access.write` rules.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WorkersQueryExecutor } from './workers-query-executor.js'
import { MockD1Database } from '../test-helpers/mocks.js'
import { D1Adapter } from '../database/d1-adapter.js'
import type { Blueprint, RequestContext } from '@zebric/runtime-core'
import { SYSTEM_SESSION } from '@zebric/runtime-core'

const ctx = (session: any): RequestContext => ({ params: {}, query: {}, session })
const member = ctx({ user: { id: 'user-1', name: 'Member', email: 'm@x.test', role: 'member' } })
const other = ctx({ user: { id: 'user-2', name: 'Other', email: 'o@x.test', role: 'member' } })
const admin = ctx({ user: { id: 'admin-1', name: 'Admin', email: 'a@x.test', role: 'admin' } })
const anon = ctx(null)
const system = ctx(SYSTEM_SESSION)

const blueprint: Blueprint = {
  version: '1.0.0',
  project: { name: 'Access', version: '1.0.0', runtime: { min_version: '0.1.0' } },
  entities: [
    {
      name: 'Doc',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'title', type: 'Text', required: true },
        { name: 'body', type: 'LongText' },
        { name: 'userId', type: 'Text', access: { write: false } },
        { name: 'assigneeId', type: 'Text', access: { write: false } },
        { name: 'region', type: 'Text', access: { write: 'authenticated' } },
        { name: 'secret', type: 'Text', access: { read: false, write: false } },
      ],
      access: {
        read: true,
        create: 'authenticated',
        update: 'owner',
        delete: { '$currentUser.role': 'admin' },
      },
    },
    {
      // No access rules at all - must keep working unchanged.
      name: 'Note',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'text', type: 'Text' },
      ],
    },
  ],
  pages: [],
}

describe('WorkersQueryExecutor access control', () => {
  let executor: WorkersQueryExecutor
  let adapter: D1Adapter

  beforeEach(async () => {
    const db = new MockD1Database()
    adapter = new D1Adapter(db as any)
    await adapter.migrate([
      `CREATE TABLE IF NOT EXISTS Doc (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,
        userId TEXT, assigneeId TEXT, region TEXT, secret TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS Note (id TEXT PRIMARY KEY, text TEXT)`,
    ])
    executor = new WorkersQueryExecutor(adapter, blueprint)
  })

  const seedDoc = (over: Record<string, any> = {}) =>
    adapter.query(
      'INSERT INTO Doc (id, title, body, userId, assigneeId, region) VALUES (?, ?, ?, ?, ?, ?)',
      [over.id ?? 'doc-1', over.title ?? 'Seed', over.body ?? 'b', over.userId ?? 'user-1',
        over.assigneeId ?? 'user-9', over.region ?? 'us'],
    )

  describe('entity-level checks', () => {
    it('applies read rules and strips unreadable fields', async () => {
      await adapter.query(
        'INSERT INTO Doc (id, title, userId, secret) VALUES (?, ?, ?, ?)',
        ['doc-read', 'Readable', 'user-1', 'server-only'],
      )
      const rows = await executor.execute({ entity: 'Doc' }, member)
      expect(rows).toHaveLength(1)
      expect(rows[0]).not.toHaveProperty('secret')
    })

    it('applies row-level filters to reads', async () => {
      const ownedBlueprint = structuredClone(blueprint)
      ownedBlueprint.entities[0]!.access!.read = 'owner'
      const ownedExecutor = new WorkersQueryExecutor(adapter, ownedBlueprint)
      await seedDoc({ id: 'mine', userId: 'user-1' })
      await seedDoc({ id: 'theirs', userId: 'user-2' })
      const rows = await ownedExecutor.execute({ entity: 'Doc' }, member)
      expect(rows.map(row => row.id)).toEqual(['mine'])
      await expect(ownedExecutor.findById('Doc', 'theirs', member)).resolves.toBeNull()
    })

    it('enforces blueprint RBAC', async () => {
      const deniedBlueprint = structuredClone(blueprint)
      deniedBlueprint.auth = { providers: ['email'], permissions: { member: { allow: [] } } }
      const deniedExecutor = new WorkersQueryExecutor(adapter, deniedBlueprint)
      await expect(deniedExecutor.execute({ entity: 'Doc' }, member)).rejects.toThrow('Access denied')
      await expect(deniedExecutor.create('Doc', { id: 'blocked', title: 'No' }, member)).rejects.toThrow('Access denied')
    })
    it('rejects create when the create rule is not satisfied', async () => {
      await expect(executor.create('Doc', { title: 'Nope' }, anon))
        .rejects.toThrow('Access denied: Cannot create Doc')
    })

    it('allows create for an authenticated caller', async () => {
      const created = await executor.create('Doc', { id: 'd-ok', title: 'Yes' }, member)
      expect(created.title).toBe('Yes')
      const rows = await adapter.query('SELECT * FROM Doc WHERE id = ?', ['d-ok'])
      expect(rows.rows).toHaveLength(1)
    })

    it('rejects update by a non-owner and allows it for the owner', async () => {
      await seedDoc({ id: 'doc-1', userId: 'user-1' })

      await expect(executor.update('Doc', 'doc-1', { title: 'Hijack' }, other))
        .rejects.toThrow('Access denied: Cannot update Doc')

      const updated = await executor.update('Doc', 'doc-1', { title: 'Owned edit' }, member)
      expect(updated.title).toBe('Owned edit')
    })

    it('does not allow ownership to be acquired in the update payload', async () => {
      const ownerWritable = structuredClone(blueprint)
      ownerWritable.entities[0]!.fields.find(field => field.name === 'userId')!.access = undefined
      const ownerExecutor = new WorkersQueryExecutor(adapter, ownerWritable)
      await seedDoc({ id: 'doc-takeover', userId: 'user-2' })
      await expect(ownerExecutor.update('Doc', 'doc-takeover', { userId: 'user-1' }, member))
        .rejects.toThrow('Access denied')
    })

    it('rejects delete without the admin role and allows it with it', async () => {
      await seedDoc({ id: 'doc-1', userId: 'user-1' })

      await expect(executor.delete('Doc', 'doc-1', member))
        .rejects.toThrow('Access denied: Cannot delete Doc')

      await executor.delete('Doc', 'doc-1', admin)
      const rows = await adapter.query('SELECT * FROM Doc WHERE id = ?', ['doc-1'])
      expect(rows.rows).toHaveLength(0)
    })

    it('rejects an update whose target row does not exist', async () => {
      await expect(executor.update('Doc', 'ghost', { title: 'x' }, member))
        .rejects.toThrow('Doc with id ghost not found')
    })

    it('treats delete of a missing row as an idempotent no-op', async () => {
      await expect(executor.delete('Doc', 'ghost', admin)).resolves.toBeUndefined()
    })

    it('lets a trusted system session bypass entity-level checks', async () => {
      await seedDoc({ id: 'doc-1', userId: 'user-1' })
      const created = await executor.create('Doc', { id: 'sys', title: 'system' }, system)
      expect(created.id).toBe('sys')
      await executor.update('Doc', 'doc-1', { title: 'system edit' }, system)
      await executor.delete('Doc', 'sys', system)
    })

    it('leaves an entity without access rules fully writable', async () => {
      const note = await executor.create('Note', { id: 'n1', text: 'hi' }, anon)
      expect(note.text).toBe('hi')
      const updated = await executor.update('Note', 'n1', { text: 'bye' }, anon)
      expect(updated.text).toBe('bye')
      await executor.delete('Note', 'n1', anon)
    })
  })

  describe('field-level write access', () => {
    it('drops a hard-protected field on create but still creates the record', async () => {
      const created = await executor.create('Doc', {
        id: 'd-1', title: 'T', assigneeId: 'attacker', userId: 'attacker',
      }, member)
      const row = (await adapter.query('SELECT * FROM Doc WHERE id = ?', ['d-1'])).rows[0]
      expect(row.title).toBe('T')
      expect(row.assigneeId ?? null).toBeNull()
      expect(row.userId ?? null).toBeNull()
      void created
    })

    it('preserves a hard-protected field on update while applying the rest', async () => {
      await seedDoc({ id: 'doc-1', userId: 'user-1', assigneeId: 'user-9' })
      const updated = await executor.update('Doc', 'doc-1', {
        title: 'New', assigneeId: 'attacker',
      }, member)
      expect(updated.title).toBe('New')
      expect(updated.assigneeId).toBe('user-9')
    })

    it('honours a conditional write rule', async () => {
      // 'region' is writable only by an authenticated principal.
      await seedDoc({ id: 'doc-1', userId: 'user-1', region: 'us' })
      const updated = await executor.update('Doc', 'doc-1', { region: 'eu' }, member)
      expect(updated.region).toBe('eu')
    })

    it('lets a system session write protected fields', async () => {
      const created = await executor.create('Doc', {
        id: 'sys-1', title: 'S', userId: 'user-7', assigneeId: 'user-8',
      }, system)
      expect(created.userId).toBe('user-7')
      expect(created.assigneeId).toBe('user-8')
    })

    it('treats an update of only-unwritable fields as a no-op returning the current row', async () => {
      await seedDoc({ id: 'doc-1', userId: 'user-1', assigneeId: 'user-9' })
      const result = await executor.update('Doc', 'doc-1', { assigneeId: 'attacker' }, member)
      expect(result.assigneeId).toBe('user-9')
      expect(result.title).toBe('Seed')
    })
  })
})
