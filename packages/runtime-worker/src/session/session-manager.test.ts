import { beforeEach, describe, expect, it } from 'vitest'
import type { HttpRequest } from '@zebric/runtime-core'
import { MockKVNamespace } from '../test-helpers/mocks.js'
import { WorkersSessionManager } from './session-manager.js'

describe('WorkersSessionManager', () => {
  let kv: MockKVNamespace
  let sessions: WorkersSessionManager

  beforeEach(() => {
    kv = new MockKVNamespace()
    sessions = new WorkersSessionManager({ kv: kv as any })
  })

  it('resolves sessions from a Fetch Request', async () => {
    const { sessionId } = await sessions.createSession('user-1', { name: 'Ada' })
    const request = new Request('https://example.com/_widget/search', {
      headers: { Cookie: `theme=dark; session=${sessionId}` },
    })

    const session = await sessions.getSession(request)

    expect(session).toMatchObject({ id: sessionId, userId: 'user-1', user: { name: 'Ada' } })
  })

  it('resolves sessions from a normalized request with case-insensitive headers', async () => {
    const { sessionId } = await sessions.createSession('user-2', { name: 'Grace' })
    const request: HttpRequest = {
      method: 'GET',
      url: 'https://example.com/',
      headers: { Cookie: `session=${sessionId}` },
    }

    const session = await sessions.getSession(request)

    expect(session).toMatchObject({ id: sessionId, userId: 'user-2' })
  })

  it('returns null when the session cookie is absent', async () => {
    const request = new Request('https://example.com/')

    await expect(sessions.getSession(request)).resolves.toBeNull()
  })
})
