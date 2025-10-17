/**
 * Field-Level Access Control Tests
 *
 * Tests for field-level read/write permissions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestHarness } from '../helpers/index.js'
import { join } from 'node:path'

describe('Field-Level Access Control', () => {
  const harness = createTestHarness()
  let engine: any
  let testDir: string
  let baseURL: string
  let adminToken: string
  let userToken: string

  beforeEach(async () => {
    await harness.createTempDir()
    testDir = harness.getTempDir()

    // Create Blueprint with field-level access control
    const blueprint = `
version = "0.1.0"

[project]
name = "Field Access Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.User]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "email", type = "Email", unique = true, required = true },
  { name = "name", type = "Text", required = true },
  { name = "role", type = "Enum", values = ["user", "admin"], default = "user" }
]

[entity.Employee]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "name", type = "Text", required = true },
  { name = "email", type = "Email", required = true },
  { name = "department", type = "Text", required = true },
  { name = "managerId", type = "Ref", ref = "User.id", required = true },

  # Admin-only field
  { name = "salary", type = "Integer", required = true, access = { read = { "$currentUser.role" = "admin" } } },

  # Self or admin can read
  { name = "privateNotes", type = "LongText", access = { read = { or = [ { "managerId" = "$currentUser.id" }, { "$currentUser.role" = "admin" } ] } } },

  # Read-only field (system-managed)
  { name = "lastModified", type = "DateTime", access = { write = false } }
]

[entity.Employee.relations]
manager = { type = "belongsTo", entity = "User", foreign_key = "managerId" }

[auth]
providers = ["email"]

[page."/employees/new"]
title = "New Employee"
auth = "required"
layout = "form"

[page."/employees/new".form]
entity = "Employee"
method = "create"

[[page."/employees/new".form.fields]]
name = "name"
type = "text"
required = true

[[page."/employees/new".form.fields]]
name = "email"
type = "email"
required = true

[[page."/employees/new".form.fields]]
name = "department"
type = "text"
required = true

[[page."/employees/new".form.fields]]
name = "salary"
type = "number"
required = true

[[page."/employees/new".form.fields]]
name = "privateNotes"
type = "textarea"

[page."/employees/new".form.onSuccess]
redirect = "/employees"

[page."/employees/:id"]
title = "Employee Detail"
auth = "required"
layout = "detail"

[page."/employees/:id".queries.employee]
entity = "Employee"
where = { id = "$params.id" }
`

    const blueprintPath = await harness.writeBlueprintFile(blueprint)

    // Get available port
    const port = await harness.getAvailablePort()

    // Start engine
    const { ZebricEngine } = await import('../../src/engine.js')
    engine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: {
        hotReload: false,
        dbPath: join(testDir, 'test.db'),
        adminPort: 0,  // Use random port to avoid conflicts
        logLevel: 'error',
      },
    })

    await engine.start()

    baseURL = `http://127.0.0.1:${port}`

    // Create admin user
    const adminRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@test.com',
        password: 'password123',
        name: 'Admin User',
        role: 'admin',
      }),
    })
    const adminCookie = adminRes.headers.get('set-cookie')
    adminToken = adminCookie?.match(/better-auth\\.session_token=([^;]+)/)?.[1] || ''

    // Create regular user
    const userRes = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@test.com',
        password: 'password123',
        name: 'Regular User',
      }),
    })
    const userCookie = userRes.headers.get('set-cookie')
    userToken = userCookie?.match(/better-auth\\.session_token=([^;]+)/)?.[1] || ''
  })

  afterEach(async () => {
    if (engine) {
      await engine.stop()
    }
    await harness.cleanup()
  })

  describe('Field Read Access (API)', () => {
    it('should work with AccessControl methods', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      // Test admin session
      const adminSession = ({ user: { id: '123', role: 'admin' }, sessionToken: 'token' }) as any
      const adminFields = AccessControl.getAccessibleFields(employeeEntity, 'read', adminSession)

      expect(adminFields).toContain('name')
      expect(adminFields).toContain('email')
      expect(adminFields).toContain('salary') // Admin can read salary

      // Test user session
      const userSession = ({ user: { id: '456', role: 'user' }, sessionToken: 'token' }) as any
      const userFields = AccessControl.getAccessibleFields(employeeEntity, 'read', userSession)

      expect(userFields).toContain('name')
      expect(userFields).toContain('email')
      expect(userFields).not.toContain('salary') // Regular user cannot read salary
    })
  })

  describe('Field Write Access (API)', () => {
    it('should filter writable fields correctly', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      // Test write access for admin
      const adminSession = ({ user: { id: '123', role: 'admin' }, sessionToken: 'token' }) as any
      const adminWriteFields = AccessControl.getAccessibleFields(employeeEntity, 'write', adminSession)

      expect(adminWriteFields).toContain('name')
      expect(adminWriteFields).toContain('salary') // Admin can write salary
      expect(adminWriteFields).not.toContain('lastModified') // No one can write this

      // Test write access for regular user
      const userSession = ({ user: { id: '456', role: 'user' }, sessionToken: 'token' }) as any
      const userWriteFields = AccessControl.getAccessibleFields(employeeEntity, 'write', userSession)

      expect(userWriteFields).toContain('name')
      expect(userWriteFields).not.toContain('salary') // User cannot write salary
      expect(userWriteFields).not.toContain('lastModified') // No one can write this
    })
  })

  describe('AccessControl.getAccessibleFields', () => {
    it('should return correct fields for admin read', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const adminSession = ({ user: { id: '123', role: 'admin' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(employeeEntity, 'read', adminSession)

      expect(fields).toContain('name')
      expect(fields).toContain('email')
      expect(fields).toContain('salary') // Admin can read salary
      expect(fields).toContain('privateNotes') // Admin can read private notes
    })

    it('should return restricted fields for regular user read', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const userSession = ({ user: { id: '456', role: 'user' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(employeeEntity, 'read', userSession)

      expect(fields).toContain('name')
      expect(fields).toContain('email')
      expect(fields).not.toContain('salary') // Regular user cannot read salary
    })

    it('should prevent write to read-only field', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const adminSession = ({ user: { id: '123', role: 'admin' }, sessionToken: 'token' }) as any
      const fields = AccessControl.getAccessibleFields(employeeEntity, 'write', adminSession)

      expect(fields).toContain('name')
      expect(fields).toContain('salary')
      expect(fields).not.toContain('lastModified') // No one can write to this
    })
  })

  describe('AccessControl.filterFields', () => {
    it('should filter sensitive fields from data object', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const data = {
        id: '123',
        name: 'John Doe',
        email: 'john@test.com',
        department: 'Engineering',
        salary: 100000,
        privateNotes: 'Secret',
        managerId: 'mgr123',
      }

      const userSession = ({ user: { id: '456', role: 'user' }, sessionToken: 'token' }) as any
      const filtered = AccessControl.filterFields(employeeEntity, 'read', data, userSession)

      expect(filtered.name).toBe('John Doe')
      expect(filtered.email).toBe('john@test.com')
      expect(filtered.salary).toBeUndefined() // Should be filtered out
      expect(filtered.privateNotes).toBeUndefined() // Should be filtered out
    })

    it('should include all fields for admin', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const data = {
        id: '123',
        name: 'John Doe',
        email: 'john@test.com',
        department: 'Engineering',
        salary: 100000,
        privateNotes: 'Secret',
        managerId: 'mgr123',
      }

      const adminSession = ({ user: { id: 'mgr123', role: 'admin' }, sessionToken: 'token' }) as any
      const filtered = AccessControl.filterFields(employeeEntity, 'read', data, adminSession)

      expect(filtered.name).toBe('John Doe')
      expect(filtered.salary).toBe(100000) // Admin can see salary
      expect(filtered.privateNotes).toBe('Secret') // Admin can see notes
    })

    it('should filter array of data objects', async () => {
      const { AccessControl } = await import('../../src/database/access-control.js')
      const blueprint = engine['blueprint']
      const employeeEntity = blueprint?.entities?.find((e: any) => e.name === 'Employee')

      expect(employeeEntity).toBeDefined()

      const dataArray = [
        { id: '1', name: 'John', salary: 100000 },
        { id: '2', name: 'Jane', salary: 90000 },
      ]

      const userSession = ({ user: { id: '456', role: 'user' }, sessionToken: 'token' }) as any
      const filtered = AccessControl.filterFieldsArray(employeeEntity, 'read', dataArray, userSession)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].name).toBe('John')
      expect(filtered[0].salary).toBeUndefined()
      expect(filtered[1].name).toBe('Jane')
      expect(filtered[1].salary).toBeUndefined()
    })
  })
})
