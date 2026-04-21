import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { NotificationManager, registerNotificationAdapterFactory } from '../src/index.js'
import type { NotificationAdapter } from '../src/types.js'

function makeAdapter(name: string, overrides: Partial<NotificationAdapter> = {}): NotificationAdapter {
  return {
    name,
    type: 'test',
    send: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('NotificationManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleSpy: MockInstance<any[], any>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('constructor and adapter registration', () => {
    it('falls back to console adapter when none configured', async () => {
      const manager = new NotificationManager()
      await manager.send({ subject: 'Hello', body: 'Test message' })
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('falls back to console adapter when config has no adapters', async () => {
      const manager = new NotificationManager({ default: 'other', adapters: [] })
      await manager.send({ body: 'fallback' })
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('warns when an unknown adapter type is specified', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      new NotificationManager({
        default: 'unknown',
        adapters: [{ name: 'unknown', type: 'nonexistent-type' }],
      })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-type'))
      warnSpy.mockRestore()
    })

    it('logs error and skips adapter when factory throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      registerNotificationAdapterFactory('throwing', () => {
        throw new Error('factory boom')
      })
      new NotificationManager({
        default: 'throws',
        adapters: [{ name: 'throws', type: 'throwing' }],
      })
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"throws"'),
        expect.any(Error)
      )
      errorSpy.mockRestore()
    })

    it('registers and uses a custom adapter factory', async () => {
      const sendFn = vi.fn().mockResolvedValue(undefined)
      registerNotificationAdapterFactory('custom', (config) => ({
        name: config.name,
        type: 'custom',
        send: sendFn,
      }))

      const manager = new NotificationManager({
        default: 'my-custom',
        adapters: [{ name: 'my-custom', type: 'custom' }],
      })
      await manager.send({ body: 'hello from custom' })
      expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({ body: 'hello from custom' }))
    })
  })

  describe('listAdapters', () => {
    it('returns names of all registered adapters', () => {
      registerNotificationAdapterFactory('list-test', (cfg) => makeAdapter(cfg.name))
      const manager = new NotificationManager({
        default: 'a',
        adapters: [
          { name: 'a', type: 'list-test' },
          { name: 'b', type: 'list-test' },
        ],
      })
      expect(manager.listAdapters()).toEqual(expect.arrayContaining(['a', 'b']))
      expect(manager.listAdapters()).toHaveLength(2)
    })

    it('returns empty array when no adapters registered', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const manager = new NotificationManager({
        default: 'none',
        adapters: [{ name: 'none', type: 'no-factory-registered' }],
      })
      expect(manager.listAdapters()).toEqual([])
      warnSpy.mockRestore()
    })
  })

  describe('send', () => {
    it('throws when no default adapter and message has no adapter', async () => {
      registerNotificationAdapterFactory('orphan', (cfg) => makeAdapter(cfg.name))
      const manager = new NotificationManager({
        adapters: [{ name: 'a', type: 'orphan' }],
        // no default
      })
      await expect(manager.send({ body: 'no target' })).rejects.toThrow(
        'No notification adapter specified'
      )
    })

    it('throws when named adapter does not exist', async () => {
      const manager = new NotificationManager()
      await expect(
        manager.send({ adapter: 'nonexistent', body: 'hello' })
      ).rejects.toThrow('Notification adapter not found: nonexistent')
    })

    it('routes to the adapter named in the message', async () => {
      const sendA = vi.fn().mockResolvedValue(undefined)
      const sendB = vi.fn().mockResolvedValue(undefined)
      registerNotificationAdapterFactory('routed', (cfg) => ({
        name: cfg.name,
        type: 'routed',
        send: cfg.name === 'alpha' ? sendA : sendB,
      }))

      const manager = new NotificationManager({
        default: 'alpha',
        adapters: [
          { name: 'alpha', type: 'routed' },
          { name: 'beta', type: 'routed' },
        ],
      })

      await manager.send({ adapter: 'beta', body: 'to beta' })
      expect(sendB).toHaveBeenCalledOnce()
      expect(sendA).not.toHaveBeenCalled()
    })

    it('renders template placeholders into body', async () => {
      const manager = new NotificationManager({
        default: 'console',
        adapters: [{ name: 'console', type: 'console' }],
      })
      await manager.send({
        template: 'Welcome {{user.name}} to {{team}}',
        params: { user: { name: 'Ari' }, team: 'Platform' },
      })
      const output = consoleSpy.mock.calls[0]?.[1] as any
      expect(output.body).toBe('Welcome Ari to Platform')
    })

    it('does not override body with template when body is already set', async () => {
      const manager = new NotificationManager({
        default: 'console',
        adapters: [{ name: 'console', type: 'console' }],
      })
      await manager.send({
        body: 'explicit body',
        template: 'should not appear',
        params: {},
      })
      const output = consoleSpy.mock.calls[0]?.[1] as any
      expect(output.body).toBe('explicit body')
    })

    it('renders template placeholders in subject', async () => {
      const manager = new NotificationManager({
        default: 'console',
        adapters: [{ name: 'console', type: 'console' }],
      })
      await manager.send({
        subject: 'Hello {{name}}',
        body: 'body text',
        params: { name: 'World' },
      })
      const output = consoleSpy.mock.calls[0]?.[1] as any
      expect(output.subject).toBe('Hello World')
    })

    it('does not mutate subject when no params are passed', async () => {
      const manager = new NotificationManager({
        default: 'console',
        adapters: [{ name: 'console', type: 'console' }],
      })
      await manager.send({ subject: 'Plain subject', body: 'body' })
      const output = consoleSpy.mock.calls[0]?.[1] as any
      expect(output.subject).toBe('Plain subject')
    })

    it('passes channel, to, and metadata to adapter', async () => {
      const sendFn = vi.fn().mockResolvedValue(undefined)
      registerNotificationAdapterFactory('passthrough', (cfg) => ({
        name: cfg.name, type: 'passthrough', send: sendFn,
      }))
      const manager = new NotificationManager({
        default: 'pt',
        adapters: [{ name: 'pt', type: 'passthrough' }],
      })
      await manager.send({
        channel: '#alerts',
        to: 'ops@example.com',
        body: 'down',
        metadata: { severity: 'high' },
      })
      expect(sendFn).toHaveBeenCalledWith({
        channel: '#alerts',
        to: 'ops@example.com',
        subject: undefined,
        body: 'down',
        metadata: { severity: 'high' },
      })
    })
  })

  describe('handleRequest', () => {
    it('returns 404 when adapter is not found', async () => {
      const manager = new NotificationManager()
      const req = new Request('https://example.com/notifications/missing/inbound', {
        method: 'POST',
        body: '{}',
      })
      const response = await manager.handleRequest('missing', req)
      expect(response.status).toBe(404)
    })

    it('returns 404 when adapter has no handleRequest method', async () => {
      registerNotificationAdapterFactory('no-handler', (cfg) => ({
        name: cfg.name,
        type: 'no-handler',
        send: vi.fn(),
        // no handleRequest
      }))
      const manager = new NotificationManager({
        default: 'nh',
        adapters: [{ name: 'nh', type: 'no-handler' }],
      })
      const req = new Request('https://example.com/inbound', { method: 'POST' })
      const response = await manager.handleRequest('nh', req)
      expect(response.status).toBe(404)
    })

    it('delegates to adapter.handleRequest when present', async () => {
      const handleFn = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
      registerNotificationAdapterFactory('with-handler', (cfg) => ({
        name: cfg.name,
        type: 'with-handler',
        send: vi.fn(),
        handleRequest: handleFn,
      }))
      const manager = new NotificationManager({
        default: 'wh',
        adapters: [{ name: 'wh', type: 'with-handler' }],
      })
      const req = new Request('https://example.com/inbound', { method: 'POST' })
      const response = await manager.handleRequest('wh', req)
      expect(response.status).toBe(200)
      expect(handleFn).toHaveBeenCalledWith(req)
    })
  })
})
