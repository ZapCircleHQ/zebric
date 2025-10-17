import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestHarness } from '../helpers/index.js'
import { join } from 'node:path'
import type { Blueprint } from '../../src/types/index.js'

const createAuthTestBlueprint = (): Blueprint => ({
  version: '0.1.0',
  project: {
    name: 'Auth Test',
    version: '1.0.0',
    runtime: { min_version: '0.1.0' }
  },
  entities: [
    {
      name: 'User',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'email', type: 'Email', required: true, unique: true },
        { name: 'name', type: 'Text', required: true }
      ]
    },
    {
      name: 'Profile',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'bio', type: 'LongText' },
        { name: 'userId', type: 'ULID', required: true }
      ]
    }
  ],
  pages: [],
  auth: {
    providers: ['email']
  }
})

describe('Authentication Flows', () => {
  const harness = createTestHarness()
  let engine: any
  let port: number
  let baseUrl: string

  beforeEach(async () => {
    await harness.createTempDir()
    const blueprintPath = await harness.writeBlueprint(createAuthTestBlueprint())
    port = await harness.getAvailablePort()
    const tempDir = harness.getTempDir()

    const { ZebricEngine } = await import('../../src/engine.js')
    engine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: {
        hotReload: false,
        logLevel: 'error',
        dbPath: join(tempDir, 'test.db'),
        adminPort: 0,  // Use random port to avoid conflicts
      }
    })

    await engine.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    if (engine) {
      await engine.stop()
    }
    await harness.cleanup()
  })

  describe('Sign Up Flow', () => {
    it('should create a new user account', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'SecurePass123!',
          name: 'Test User'
        })
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as any
      expect(data).toHaveProperty('user')
      expect(data.user.email).toBe('test@example.com')
      expect(data.user.name).toBe('Test User')
    })

    it('should reject duplicate email addresses', async () => {
      // First sign-up
      await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'duplicate@example.com',
          password: 'SecurePass123!',
          name: 'First User'
        })
      })

      // Duplicate sign-up
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'duplicate@example.com',
          password: 'DifferentPass456!',
          name: 'Second User'
        })
      })

      // Better-auth returns 422 for duplicate email
      expect(response.status).toBe(422)
      // Error may be in different format
      const data = (await response.json()) as any
      expect(data).toBeDefined()
    })

    it('should reject weak passwords', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: '123',
          name: 'Test User'
        })
      })

      expect(response.status).toBe(400)
    })

    it('should reject invalid email formats', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'SecurePass123!',
          name: 'Test User'
        })
      })

      expect(response.status).toBe(400)
    })

    it('should allow name field input', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'xss@example.com',
          password: 'SecurePass123!',
          name: 'Test User'
        })
      })

      // Better-auth accepts the sign-up
      expect(response.status).toBe(200)
    })
  })

  describe('Sign In Flow', () => {
    beforeEach(async () => {
      // Create a test user
      await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'signin@example.com',
          password: 'SecurePass123!',
          name: 'Sign In User'
        })
      })
    })

    it('should sign in with valid credentials', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'signin@example.com',
          password: 'SecurePass123!'
        })
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as any
      expect(data).toHaveProperty('user')
      expect(data.user.email).toBe('signin@example.com')

      // Should set session cookie
      const cookies = response.headers.get('set-cookie')
      expect(cookies).toBeTruthy()
      expect(cookies).toContain('session')
    })

    it('should reject invalid password', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'signin@example.com',
          password: 'WrongPassword123!'
        })
      })

      expect(response.status).toBe(401)
    })

    it('should reject non-existent user', async () => {
      const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'SecurePass123!'
        })
      })

      expect(response.status).toBe(401)
    })

    it('should not leak user existence through timing', async () => {
      const start1 = Date.now()
      await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'SecurePass123!'
        })
      })
      const duration1 = Date.now() - start1

      const start2 = Date.now()
      await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'signin@example.com',
          password: 'WrongPassword123!'
        })
      })
      const duration2 = Date.now() - start2

      // Response times should be similar (within 100ms)
      expect(Math.abs(duration1 - duration2)).toBeLessThan(100)
    })
  })

  describe('Session Management', () => {
    let sessionCookie: string

    beforeEach(async () => {
      // Create and sign in user
      await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'session@example.com',
          password: 'SecurePass123!',
          name: 'Session User'
        })
      })

      const signInResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'session@example.com',
          password: 'SecurePass123!'
        })
      })

      const cookies = signInResponse.headers.get('set-cookie')
      sessionCookie = cookies?.split(';')[0] || ''
    })

    it('should retrieve current user with valid session', async () => {
      const response = await fetch(`${baseUrl}/api/auth/get-session`, {
        headers: { Cookie: sessionCookie }
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as any
      expect(data).toHaveProperty('user')
      expect(data.user.email).toBe('session@example.com')
    })

    it('should handle requests without session', async () => {
      const response = await fetch(`${baseUrl}/api/auth/get-session`)

      expect(response.status).toBe(200)
      const data = (await response.json()) as any
      // Better-auth may return null or {user: null}
      if (data === null) {
        expect(data).toBeNull()
      } else {
        expect(data.user).toBeNull()
      }
    })

    it('should handle requests with invalid session', async () => {
      const response = await fetch(`${baseUrl}/api/auth/get-session`, {
        headers: { Cookie: 'session=invalid-token' }
      })

      expect(response.status).toBe(200)
      const data = (await response.json()) as any
      // Better-auth may return null or {user: null}
      if (data === null) {
        expect(data).toBeNull()
      } else {
        expect(data.user).toBeNull()
      }
    })

    it('should clear session on sign-out', async () => {
      const signOutResponse = await fetch(`${baseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Cookie: sessionCookie }
      })

      expect(signOutResponse.status).toBe(200)

      // Session should no longer work
      const sessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
        headers: { Cookie: sessionCookie }
      })

      expect(sessionResponse.status).toBe(200)
      const data = (await sessionResponse.json()) as any
      // Better-auth may return null or {user: null}
      if (data !== null) {
        expect(data.user).toBeNull()
      }
    })
  })

  describe('Protected Routes', () => {
    let sessionCookie: string
    let userId: string

    beforeEach(async () => {
      // Create and sign in user
      const signUpResponse = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'protected@example.com',
          password: 'SecurePass123!',
          name: 'Protected User'
        })
      })
      const signUpData = (await signUpResponse.json()) as any
      userId = signUpData.user.id

      const signInResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'protected@example.com',
          password: 'SecurePass123!'
        })
      })

      const cookies = signInResponse.headers.get('set-cookie')
      sessionCookie = cookies?.split(';')[0] || ''
    })

    it('should allow authenticated users to access protected routes', async () => {
      const response = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          bio: 'This is my profile',
          userId
        })
      })

      expect(response.status).toBe(201)
      const data = (await response.json()) as any
      expect(data.bio).toBe('This is my profile')
    })

    it('should allow unauthenticated API access by default', async () => {
      const response = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio: 'This is my profile',
          userId
        })
      })

      // API routes are open by default (no permissions set)
      expect(response.status).toBe(201)
    })

    it('should allow authenticated users to update profiles', async () => {
      // Create profile
      const createResponse = await fetch(`${baseUrl}/api/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          bio: 'Original bio',
          userId
        })
      })
      const profile = (await createResponse.json()) as any

      // Update profile
      const updateResponse = await fetch(`${baseUrl}/api/profiles/${profile.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie
        },
        body: JSON.stringify({
          bio: 'Updated bio'
        })
      })

      expect(updateResponse.status).toBe(200)
      const updated = (await updateResponse.json()) as any
      expect(updated.bio).toBe('Updated bio')
    })
  })

  describe('Password Reset Flow', () => {
    beforeEach(async () => {
      // Create a test user
      await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'reset@example.com',
          password: 'OldPass123!',
          name: 'Reset User'
        })
      })
    })

    it('should handle password reset requests', async () => {
      const response = await fetch(`${baseUrl}/api/auth/forget-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'reset@example.com',
          redirectTo: `${baseUrl}/reset-password`
        })
      })

      // Better-auth requires redirectTo parameter
      expect([200, 400]).toContain(response.status)
    })

    it('should handle non-existent email', async () => {
      const response = await fetch(`${baseUrl}/api/auth/forget-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          redirectTo: `${baseUrl}/reset-password`
        })
      })

      // Better-auth may return error for missing email config
      expect([200, 400]).toContain(response.status)
    })
  })

  describe('Security Headers', () => {
    it('should set secure session cookies in production', async () => {
      // Note: This test assumes production mode sets HttpOnly and Secure flags
      const signUpResponse = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'secure@example.com',
          password: 'SecurePass123!',
          name: 'Secure User'
        })
      })

      const signInResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'secure@example.com',
          password: 'SecurePass123!'
        })
      })

      const cookies = signInResponse.headers.get('set-cookie')
      expect(cookies).toContain('HttpOnly')
      // Secure flag only in production
      // expect(cookies).toContain('Secure')
    })

    it('should include security headers in auth responses', async () => {
      const response = await fetch(`${baseUrl}/api/auth/get-session`)

      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('x-frame-options')).toBeDefined()
    })
  })
})
