import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuditLoggerPort, LogEvent } from '@zebric/runtime-core'
import type { D1Adapter } from '../database/d1-adapter.js'
import { D1RuntimeJournal } from './d1-runtime-journal.js'

/** Request-scoped security events; mutation history keeps its atomic journal path. */
export class WorkersSecurityAudit implements AuditLoggerPort {
  private readonly requests = new AsyncLocalStorage<LogEvent[]>()
  private readonly journal: D1RuntimeJournal
  constructor(private readonly db: D1Adapter) { this.journal = new D1RuntimeJournal(db) }

  log(event: LogEvent): void { this.requests.getStore()?.push(event) }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const entries: LogEvent[] = []
    return this.requests.run(entries, async () => {
      try { return await operation() }
      finally {
        if (entries.length) {
          try {
            const statements = await this.journal.prepare({ audit: entries, events: [] })
            await this.db.batch(statements)
          } catch (error) { console.error('Security audit persistence failed:', error) }
        }
      }
    })
  }
}
