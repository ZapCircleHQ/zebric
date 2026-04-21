import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailAdapter } from '../src/adapters/email-adapter.js'

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

import { appendFile } from 'node:fs/promises'
const mockAppendFile = appendFile as ReturnType<typeof vi.fn>

describe('EmailAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends formatted email entry to the outbox file', async () => {
    const adapter = new EmailAdapter('email', { from: 'noreply@example.com' })
    await adapter.send({ to: 'user@example.com', subject: 'Hello', body: 'World' })

    expect(mockAppendFile).toHaveBeenCalledOnce()
    const [filePath, content] = mockAppendFile.mock.calls[0] as [string, string, any]
    expect(filePath).toBe('./data/email-outbox.log')
    expect(content).toContain('From: noreply@example.com')
    expect(content).toContain('To: user@example.com')
    expect(content).toContain('Subject: Hello')
    expect(content).toContain('World')
  })

  it('uses custom outboxFile path when configured', async () => {
    const adapter = new EmailAdapter('email', {
      from: 'from@example.com',
      outboxFile: '/tmp/test-outbox.log',
    })
    await adapter.send({ to: 'a@b.com', subject: 'Test', body: 'Body' })

    const [filePath] = mockAppendFile.mock.calls[0] as [string, string, any]
    expect(filePath).toBe('/tmp/test-outbox.log')
  })

  it('throws when no "to" address is provided', async () => {
    const adapter = new EmailAdapter('email', { from: 'noreply@example.com' })
    await expect(adapter.send({ subject: 'No recipient', body: 'oops' })).rejects.toThrow(
      'Email adapter requires "to"'
    )
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it('defaults subject to "Notification" when omitted', async () => {
    const adapter = new EmailAdapter('email', { from: 'from@example.com' })
    await adapter.send({ to: 'user@example.com', body: 'Content' })

    const [, content] = mockAppendFile.mock.calls[0] as [string, string, any]
    expect(content).toContain('Subject: Notification')
  })

  it('uses empty string body when body is omitted', async () => {
    const adapter = new EmailAdapter('email', { from: 'from@example.com' })
    await adapter.send({ to: 'user@example.com', subject: 'No body' })

    const [, content] = mockAppendFile.mock.calls[0] as [string, string, any]
    expect(content).toContain('Subject: No body')
  })

  it('exposes correct name and type', () => {
    const adapter = new EmailAdapter('primary-email', { from: 'a@b.com' })
    expect(adapter.name).toBe('primary-email')
    expect(adapter.type).toBe('email')
  })
})
