import { describe, expect, it, vi } from 'vitest'
import { DisabledAuthProvider } from '../auth/index.js'
import { SubsystemInitializer, drainAuditOutbox, resolveAuthDbPath } from './subsystem-initializer.js'

describe('authentication initialization', () => {
  it('does not initialize Better Auth when the Blueprint has no auth configuration', async () => {
    const logger = { info: vi.fn(), child: vi.fn() }
    const initializer = new SubsystemInitializer({
      blueprint: {
        version: '0.6.0',
        project: { name: 'Public App', version: '1.0.0', runtime: { min_version: '0.6.0' } },
        entities: [],
        pages: [{ path: '/', title: 'Home', layout: 'list', auth: 'none' }],
      },
      config: { blueprintPath: 'blueprint.toml' },
      metrics: {} as any,
      plugins: {} as any,
      auditLogger: {} as any,
      errorSanitizer: {} as any,
      logger: logger as any,
    })

    const { authProvider, sessionManager } = await initializer.initializeAuth()

    expect(authProvider).toBeInstanceOf(DisabledAuthProvider)
    await expect(sessionManager.getSession(new Request('http://localhost/'))).resolves.toBeNull()
    expect(logger.info).toHaveBeenCalledWith('Authentication disabled (no [auth] configuration)')
  })
})

describe('resolveAuthDbPath', () => {
  it('uses an explicit sqlite database.url over dev.dbPath', () => {
    expect(
      resolveAuthDbPath({
        database: { url: 'sqlite:///tmp/custom.db' },
        dev: { dbPath: '/tmp/dev-only.db' },
      })
    ).toBe('/tmp/custom.db')
  })

  it('strips the sqlite:// prefix when there is no dev config at all', () => {
    expect(resolveAuthDbPath({ database: { url: 'sqlite:///tmp/custom.db' } })).toBe(
      '/tmp/custom.db'
    )
  })

  it('falls back to dev.dbPath when no database.url is configured', () => {
    expect(resolveAuthDbPath({ dev: { dbPath: '/tmp/dev-only.db' } })).toBe('/tmp/dev-only.db')
  })

  it('falls back to the default file when neither database.url nor dev.dbPath is set', () => {
    expect(resolveAuthDbPath({})).toBe('./data/app.db')
  })

  it('falls back to dev.dbPath for a postgres database.url, since Better Auth only supports sqlite', () => {
    expect(
      resolveAuthDbPath({
        database: { url: 'postgres://user:pass@host/db' },
        dev: { dbPath: '/tmp/dev-only.db' },
      })
    ).toBe('/tmp/dev-only.db')
  })
})

describe('drainAuditOutbox', () => {
  it('drains every batch instead of stopping after the first 100 records', async () => {
    const pending = Array.from({ length: 205 }, (_, index) => ({
      id: `event-${index}`,
      topic: 'workflow.completed',
      payload: JSON.stringify({ eventType: 'workflow.completed', action: `event-${index}` }),
      createdAt: index,
    }))
    const queryExecutor = {
      listPendingAuditOutbox: vi.fn(async (limit: number) => pending.slice(0, limit)),
      markAuditOutboxDelivered: vi.fn(async (id: string) => {
        const index = pending.findIndex(record => record.id === id)
        if (index >= 0) pending.splice(index, 1)
      }),
    }
    const auditLogger = { log: vi.fn(() => true) }

    await drainAuditOutbox(queryExecutor, auditLogger)

    expect(pending).toHaveLength(0)
    expect(auditLogger.log).toHaveBeenCalledTimes(205)
    expect(queryExecutor.listPendingAuditOutbox).toHaveBeenCalledTimes(4)
  })

  it('does not acknowledge a record when durable append fails', async () => {
    const queryExecutor = {
      listPendingAuditOutbox: vi.fn(async () => [{
        id: 'event-1', topic: 'workflow.completed', payload: '{}', createdAt: 1,
      }]),
      markAuditOutboxDelivered: vi.fn(),
    }
    await expect(drainAuditOutbox(queryExecutor, { log: () => false }))
      .rejects.toThrow('delivery failed')
    expect(queryExecutor.markAuditOutboxDelivered).not.toHaveBeenCalled()
  })
})
