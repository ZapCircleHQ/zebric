import { describe, expect, it } from 'vitest'
import { WorkersSessionManager } from './session-manager.js'
import { MockKVNamespace } from '../test-helpers/mocks.js'

describe('WorkersSessionManager', () => {
  it('reads a session from a native Fetch Request cookie header', async () => {
    const kv = new MockKVNamespace() as any
    const manager = new WorkersSessionManager({ kv })
    const { sessionId } = await manager.createSession('user-1', { id: 'user-1', email: 'test@example.com' })

    const request = new Request('https://example.com/secure', {
      headers: {
        cookie: `session=${encodeURIComponent(sessionId)}`,
      },
    })

    const session = await manager.getSession(request)
    expect(session?.id).toBe(sessionId)
    expect(session?.user.id).toBe('user-1')
  })
})
