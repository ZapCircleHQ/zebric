import { describe, it, expect } from 'vitest'
import { AccessControl } from './access-control.js'
import type { Entity } from '../types/blueprint.js'

const makeEntity = (access?: any, fields?: any[]): Entity => ({
  name: 'Task',
  fields: fields || [
    { name: 'id', type: 'ULID', primary_key: true, required: true },
    { name: 'title', type: 'Text', required: true },
    { name: 'userId', type: 'Text' },
  ],
  access,
})

const authenticatedSession = {
  user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
}

describe('AccessControl', () => {
  describe('checkAccess - string shorthand conditions', () => {
    it('should allow public access without session', async () => {
      const entity = makeEntity({ read: 'public', create: 'public' })
      expect(await AccessControl.checkAccess({
        action: 'read', entity,
      })).toBe(true)
    })

    it('should allow authenticated access with session', async () => {
      const entity = makeEntity({ create: 'authenticated' })
      expect(await AccessControl.checkAccess({
        action: 'create', entity, session: authenticatedSession,
      })).toBe(true)
    })

    it('should deny authenticated access without session', async () => {
      const entity = makeEntity({ create: 'authenticated' })
      expect(await AccessControl.checkAccess({
        action: 'create', entity, session: null,
      })).toBe(false)
    })

    it('should allow owner access when userId matches', async () => {
      const entity = makeEntity({ update: 'owner' })
      expect(await AccessControl.checkAccess({
        action: 'update', entity,
        session: authenticatedSession,
        data: { userId: 'user-123' },
      })).toBe(true)
    })

    it('should deny owner access when userId does not match', async () => {
      const entity = makeEntity({ update: 'owner' })
      expect(await AccessControl.checkAccess({
        action: 'update', entity,
        session: authenticatedSession,
        data: { userId: 'other-user' },
      })).toBe(false)
    })

    it('should deny owner access without session', async () => {
      const entity = makeEntity({ delete: 'owner' })
      expect(await AccessControl.checkAccess({
        action: 'delete', entity, session: null,
        data: { userId: 'user-123' },
      })).toBe(false)
    })
  })

  describe('checkAccess - boolean conditions', () => {
    it('should allow access with true', async () => {
      const entity = makeEntity({ read: true })
      expect(await AccessControl.checkAccess({
        action: 'read', entity,
      })).toBe(true)
    })

    it('should deny access with false', async () => {
      const entity = makeEntity({ read: false })
      expect(await AccessControl.checkAccess({
        action: 'read', entity, data: {},
      })).toBe(false)
    })
  })

  describe('checkAccess - no access rules', () => {
    it('should allow access when no rules defined', async () => {
      const entity = makeEntity(undefined)
      expect(await AccessControl.checkAccess({
        action: 'read', entity,
      })).toBe(true)
    })

    it('should allow access when no condition for action', async () => {
      const entity = makeEntity({ read: 'public' })
      expect(await AccessControl.checkAccess({
        action: 'create', entity,
      })).toBe(true)
    })
  })

  describe('checkAccess - object conditions', () => {
    it('should evaluate field-based conditions', async () => {
      const entity = makeEntity({ update: { userId: '$currentUser.id' } })
      expect(await AccessControl.checkAccess({
        action: 'update', entity,
        session: authenticatedSession,
        data: { userId: 'user-123' },
      })).toBe(true)
    })

    it('should deny when field condition does not match', async () => {
      const entity = makeEntity({ update: { userId: '$currentUser.id' } })
      expect(await AccessControl.checkAccess({
        action: 'update', entity,
        session: authenticatedSession,
        data: { userId: 'other-user' },
      })).toBe(false)
    })
  })

  describe('checkAccess - compound conditions', () => {
    it('should evaluate AND conditions', async () => {
      const entity = makeEntity({
        update: { and: ['authenticated', { userId: '$currentUser.id' }] }
      })
      expect(await AccessControl.checkAccess({
        action: 'update', entity,
        session: authenticatedSession,
        data: { userId: 'user-123' },
      })).toBe(true)
    })

    it('should evaluate OR conditions', async () => {
      const entity = makeEntity({
        read: { or: ['public', 'authenticated'] }
      })
      expect(await AccessControl.checkAccess({
        action: 'read', entity, session: null,
      })).toBe(true)
    })
  })

  describe('getAccessibleFields', () => {
    it('should return all fields when no access rules', () => {
      const entity = makeEntity(undefined, [
        { name: 'id', type: 'ULID' },
        { name: 'title', type: 'Text' },
        { name: 'secret', type: 'Text' },
      ])
      const fields = AccessControl.getAccessibleFields(entity, 'read')
      expect(fields).toEqual(['id', 'title', 'secret'])
    })

    it('should filter fields with access rules', () => {
      const entity = makeEntity(undefined, [
        { name: 'id', type: 'ULID' },
        { name: 'title', type: 'Text' },
        { name: 'secret', type: 'Text', access: { read: 'authenticated' } },
      ])
      const fields = AccessControl.getAccessibleFields(entity, 'read', null)
      expect(fields).toContain('id')
      expect(fields).toContain('title')
      expect(fields).not.toContain('secret')
    })

    it('should include restricted fields for authenticated users', () => {
      const entity = makeEntity(undefined, [
        { name: 'id', type: 'ULID' },
        { name: 'secret', type: 'Text', access: { read: 'authenticated' } },
      ])
      const fields = AccessControl.getAccessibleFields(entity, 'read', authenticatedSession)
      expect(fields).toContain('secret')
    })
  })

  describe('filterFields', () => {
    it('should filter data to accessible fields', () => {
      const entity = makeEntity(undefined, [
        { name: 'id', type: 'ULID' },
        { name: 'title', type: 'Text' },
        { name: 'secret', type: 'Text', access: { read: 'authenticated' } },
      ])
      const result = AccessControl.filterFields(entity, 'read', {
        id: '1', title: 'Test', secret: 'hidden'
      }, null)
      expect(result).toEqual({ id: '1', title: 'Test' })
    })
  })

  describe('canAccessField', () => {
    it('should allow access when no field access rules', () => {
      const field = { name: 'title', type: 'Text' as const }
      expect(AccessControl.canAccessField(field, 'read')).toBe(true)
    })

    it('should enforce write restriction when read is restricted', () => {
      const field = {
        name: 'email', type: 'Text' as const,
        access: { read: 'authenticated' as const }
      }
      // Write should inherit from read restriction
      expect(AccessControl.canAccessField(field, 'write', null)).toBe(false)
      expect(AccessControl.canAccessField(field, 'write', authenticatedSession)).toBe(true)
    })
  })
})
