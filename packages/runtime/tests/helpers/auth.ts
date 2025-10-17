import type { EngineTestHarness } from './engine-harness.js'

/**
 * Authentication Test Helpers
 *
 * Utilities for creating users and authenticated sessions in tests
 */

export interface TestUser {
  email: string
  password: string
  name: string
  role?: string
}

export interface AuthSession {
  token: string
  user: any
}

/**
 * Create a user via the auth API
 */
export async function createUser(
  harness: EngineTestHarness,
  user: TestUser
): Promise<any> {
  const response = await harness.post('/auth/signup', {
    email: user.email,
    password: user.password,
    name: user.name,
    role: user.role,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create user: ${error}`)
  }

  return response.json()
}

/**
 * Login a user and get auth token
 */
export async function loginUser(
  harness: EngineTestHarness,
  email: string,
  password: string
): Promise<AuthSession> {
  const response = await harness.post('/auth/login', {
    email,
    password,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to login: ${error}`)
  }

  const data = (await response.json()) as any
  return {
    token: data.token || data.accessToken || data.session?.token,
    user: data.user,
  }
}

/**
 * Create a user and login in one step
 */
export async function createAuthenticatedUser(
  harness: EngineTestHarness,
  user: TestUser
): Promise<AuthSession> {
  await createUser(harness, user)
  return loginUser(harness, user.email, user.password)
}

/**
 * Add auth headers to a request headers object
 */
export function withAuth(
  headers: Record<string, string>,
  token: string
): Record<string, string> {
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

/**
 * Create multiple authenticated users with different roles
 */
export async function createAuthenticatedUsers(
  harness: EngineTestHarness,
  users: TestUser[]
): Promise<Map<string, AuthSession>> {
  const sessions = new Map<string, AuthSession>()

  for (const user of users) {
    const session = await createAuthenticatedUser(harness, user)
    sessions.set(user.role || user.email, session)
  }

  return sessions
}

/**
 * Get the current user from the session
 */
export async function getCurrentUser(
  harness: EngineTestHarness,
  token: string
): Promise<any> {
  const response = await harness.get('/auth/me', withAuth({}, token))

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get current user: ${error}`)
  }

  return response.json()
}

/**
 * Logout a user
 */
export async function logoutUser(
  harness: EngineTestHarness,
  token: string
): Promise<void> {
  const response = await harness.post('/auth/logout', {}, withAuth({}, token))

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to logout: ${error}`)
  }
}

/**
 * Verify a token is valid
 */
export async function verifyToken(
  harness: EngineTestHarness,
  token: string
): Promise<boolean> {
  try {
    const response = await harness.get('/auth/me', withAuth({}, token))
    return response.ok
  } catch {
    return false
  }
}

/**
 * Create a test user with specific role
 */
export function createTestUser(
  email: string,
  role: string = 'user'
): TestUser {
  return {
    email,
    password: 'Test123!@#',
    name: email.split('@')[0],
    role,
  }
}

/**
 * Create standard test users (admin, editor, viewer)
 */
export function createStandardTestUsers(): TestUser[] {
  return [
    createTestUser('admin@test.com', 'admin'),
    createTestUser('editor@test.com', 'editor'),
    createTestUser('viewer@test.com', 'viewer'),
  ]
}

/**
 * Wait for auth system to be ready
 * Some auth systems need time to initialize
 */
export async function waitForAuth(
  harness: EngineTestHarness,
  maxAttempts: number = 10,
  delayMs: number = 100
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await harness.get('/auth/status')
      if (response.ok) {
        return
      }
    } catch {
      // Auth not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  throw new Error(`Auth system failed to initialize after ${maxAttempts * delayMs}ms`)
}
