import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NotificationManager } from '../src/index.js'

describe('NotificationManager', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('falls back to console adapter when none configured', async () => {
    const manager = new NotificationManager()
    await manager.send({ subject: 'Hello', body: 'Test message' })

    expect(consoleSpy).toHaveBeenCalled()
  })

  it('renders template placeholders', async () => {
    const manager = new NotificationManager({
      default: 'console',
      adapters: [{ name: 'console', type: 'console' }],
    })

    await manager.send({
      template: 'Welcome {{user.name}} to {{team}}',
      params: { user: { name: 'Ari' }, team: 'Platform' },
    })

    const output = consoleSpy.mock.calls[0]?.[1]
    expect(output.body).toBe('Welcome Ari to Platform')
  })
})
