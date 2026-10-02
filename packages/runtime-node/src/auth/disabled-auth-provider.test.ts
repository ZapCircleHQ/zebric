import { describe, it, expect } from 'vitest'
import type { UserSession } from '@zebric/runtime-core'
import { DisabledAuthProvider } from './disabled-auth-provider.js'

const session = {
  user: { id: 'user-1', email: 'a@example.com', role: 'admin' },
} as unknown as UserSession

describe('DisabledAuthProvider', () => {
  const provider = new DisabledAuthProvider()

  it('throws when the auth instance is requested', () => {
    expect(() => provider.getAuthInstance()).toThrow(
      'Authentication is not configured for this application'
    )
  })

  it('never returns a session', async () => {
    const request = new Request('http://localhost/', {
      headers: { cookie: 'session=abc', authorization: 'Bearer token' },
    })
    await expect(provider.getSession(request)).resolves.toBeNull()
  })

  it('denies every role check, with or without a session', () => {
    expect(provider.hasRole(null, 'admin')).toBe(false)
    expect(provider.hasRole(session, 'admin')).toBe(false)
  })

  it('denies ownership checks, with or without a session', () => {
    expect(provider.ownsResource(null, 'user-1')).toBe(false)
    expect(provider.ownsResource(session, 'user-1')).toBe(false)
  })
})
