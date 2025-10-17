/**
 * Unit tests for field-level access control logic
 */

import { describe, it, expect } from 'vitest'
import { AccessControl } from '../../src/database/access-control.js'
import type { Entity, Field } from '../../src/types/blueprint.js'

describe('Field-Level Access Control Logic', () => {
  const createField = (name: string, access?: any): Field => ({
    name,
    type: 'Text',
    access,
  })

  const createEntity = (fields: Field[]): Entity => ({
    name: 'TestEntity',
    fields,
  })

  describe('canAccessField', () => {
    it('should allow access to field without access rules', () => {
      const field = createField('name')
      const result = AccessControl.canAccessField(field, 'read', null)
      expect(result).toBe(true)
    })

    it('should inherit read restriction when no write condition exists', () => {
      // Security: if read is restricted but write is not specified, inherit the read restriction
      // This prevents users from writing data they cannot read
      const field = createField('name', { read: { "$currentUser.role": "admin" } })

      // Unauthenticated user cannot read (due to admin requirement), so cannot write either
      const resultUnauthenticated = AccessControl.canAccessField(field, 'write', null)
      expect(resultUnauthenticated).toBe(false)

      // Admin can read, so admin can also write
      const adminSession = ({ user: { id: '1', role: 'admin' }, sessionToken: 'token' }) as any
      const resultAdmin = AccessControl.canAccessField(field, 'write', adminSession)
      expect(resultAdmin).toBe(true)

      // Regular user cannot read, so cannot write either
      const userSession = ({ user: { id: '2', role: 'user' }, sessionToken: 'token' }) as any
      const resultUser = AccessControl.canAccessField(field, 'write', userSession)
      expect(resultUser).toBe(false)
    })

    it('should deny access with false condition', () => {
      const field = createField('name', { write: false })
      const result = AccessControl.canAccessField(field, 'write', ({ user: { id: '1', role: 'admin' } }) as any)
      expect(result).toBe(false)
    })

    it('should allow access with true condition', () => {
      const field = createField('name', { read: true })
      const result = AccessControl.canAccessField(field, 'read', null)
      expect(result).toBe(true)
    })

    it('should check role-based condition correctly', () => {
      const field = createField('salary', {
        read: { "$currentUser.role": "admin" }
      })

      const adminSession = ({ user: { id: '1', role: 'admin' }, sessionToken: 'token' }) as any
      const userSession = ({ user: { id: '2', role: 'user' }, sessionToken: 'token' }) as any

      expect(AccessControl.canAccessField(field, 'read', adminSession)).toBe(true)
      expect(AccessControl.canAccessField(field, 'read', userSession)).toBe(false)
    })

    it('should check OR condition correctly', () => {
      const field = createField('privateNotes', {
        read: {
          or: [
            { "managerId": "$currentUser.id" },
            { "$currentUser.role": "admin" }
          ]
        }
      })

      const adminSession = ({ user: { id: '1', role: 'admin' }, sessionToken: 'token' }) as any
      const managerSession = ({ user: { id: '2', role: 'user' }, sessionToken: 'token' }) as any
      const otherSession = ({ user: { id: '3', role: 'user' }, sessionToken: 'token' }) as any

      const data = { managerId: '2' }

      expect(AccessControl.canAccessField(field, 'read', adminSession, data)).toBe(true)
      expect(AccessControl.canAccessField(field, 'read', managerSession, data)).toBe(true)
      expect(AccessControl.canAccessField(field, 'read', otherSession, data)).toBe(false)
    })
  })

  describe('getAccessibleFields', () => {
    it('should return all fields when no access rules', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('email'),
      ])

      const fields = AccessControl.getAccessibleFields(entity, 'read', null)
      expect(fields).toEqual(['id', 'name', 'email'])
    })

    it('should filter admin-only fields for regular user', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('salary', { read: { "$currentUser.role": "admin" } }),
      ])

      const userSession = ({ user: { id: '1', role: 'user' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(entity, 'read', userSession)

      expect(fields).toContain('id')
      expect(fields).toContain('name')
      expect(fields).not.toContain('salary')
    })

    it('should include admin-only fields for admin', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('salary', { read: { "$currentUser.role": "admin" } }),
      ])

      const adminSession = ({ user: { id: '1', role: 'admin' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(entity, 'read', adminSession)

      expect(fields).toContain('id')
      expect(fields).toContain('name')
      expect(fields).toContain('salary')
    })

    it('should filter write-only=false fields', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('lastModified', { write: false }),
      ])

      const adminSession = ({ user: { id: '1', role: 'admin' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(entity, 'write', adminSession)

      expect(fields).toContain('id')
      expect(fields).toContain('name')
      expect(fields).not.toContain('lastModified')
    })
  })

  describe('filterFields', () => {
    it('should remove fields user cannot read', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('salary', { read: { "$currentUser.role": "admin" } }),
      ])

      const data = { id: '1', name: 'John', salary: 100000 }
      const userSession = ({ user: { id: '2', role: 'user' }, sessionToken: 'token' }) as any

      const filtered = AccessControl.filterFields(entity, 'read', data, userSession)

      expect(filtered.id).toBe('1')
      expect(filtered.name).toBe('John')
      expect(filtered.salary).toBeUndefined()
    })

    it('should include all fields for admin', () => {
      const entity = createEntity([
        createField('id'),
        createField('name'),
        createField('salary', { read: { "$currentUser.role": "admin" } }),
      ])

      const data = { id: '1', name: 'John', salary: 100000 }
      const adminSession = ({ user: { id: '2', role: 'admin' }, sessionToken: 'token' }) as any

      const filtered = AccessControl.filterFields(entity, 'read', data, adminSession)

      expect(filtered.id).toBe('1')
      expect(filtered.name).toBe('John')
      expect(filtered.salary).toBe(100000)
    })
  })
})
