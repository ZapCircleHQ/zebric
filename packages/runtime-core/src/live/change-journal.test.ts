import { describe, expect, it } from 'vitest'
import { SqlChangeJournal } from './change-journal.js'

/** Tiny in-memory stand-in for the journal table, matching only the queries the journal issues. */
function fakeStorage(rows: Array<{ sequence: number; entity: string; timestamp: string }>) {
  return {
    rows,
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith('DELETE')) {
        const max = Math.max(...rows.map(r => r.sequence))
        const keep = rows.filter(r => !(r.timestamp < (params[0] as string) && r.sequence < max))
        rows.splice(0, rows.length, ...keep)
        return { rows: [] }
      }
      if (sql.includes('AS cursor')) return { rows: [{ cursor: Math.max(0, ...rows.map(r => r.sequence)) }] }
      if (sql.includes('MIN(sequence)')) return { rows: [{ oldest: rows.length ? Math.min(...rows.map(r => r.sequence)) : null }] }
      const [from, to, ...entities] = params as [number, number, ...string[]]
      return { rows: rows.filter(r => r.sequence > from && r.sequence <= to && entities.includes(r.entity)) }
    },
  }
}

describe('SqlChangeJournal retention', () => {
  const now = Date.parse('2026-01-10T00:00:00Z')
  const old = '2026-01-01T00:00:00Z'
  const fresh = '2026-01-09T23:00:00Z'

  it('prunes old rows but always keeps the newest', async () => {
    const storage = fakeStorage([
      { sequence: 1, entity: 'A', timestamp: old },
      { sequence: 2, entity: 'A', timestamp: old },
      { sequence: 3, entity: 'A', timestamp: fresh },
    ])
    await new SqlChangeJournal(storage, 24 * 3600_000).prune(now)
    expect(storage.rows.map(r => r.sequence)).toEqual([3])
    await new SqlChangeJournal(storage, 1).prune(now + 10 * 24 * 3600_000)
    expect(storage.rows.map(r => r.sequence)).toEqual([3])
  })

  it('does not prune when retention is disabled', async () => {
    const storage = fakeStorage([{ sequence: 1, entity: 'A', timestamp: old }, { sequence: 2, entity: 'A', timestamp: old }])
    await new SqlChangeJournal(storage, 0).prune(now)
    expect(storage.rows).toHaveLength(2)
  })

  it('treats a cursor older than the oldest retained row as changed', async () => {
    const storage = fakeStorage([{ sequence: 5, entity: 'B', timestamp: fresh }, { sequence: 6, entity: 'B', timestamp: fresh }])
    const journal = new SqlChangeJournal(storage, 0)
    expect(await journal.reconcile([{ entity: 'A' }], '2')).toEqual({ cursor: '6', changed: true })
    expect(await journal.reconcile([{ entity: 'A' }], '5')).toEqual({ cursor: '6', changed: false })
  })

  it('does not treat the cursor immediately before retained history as a gap', async () => {
    const journal = new SqlChangeJournal(fakeStorage([{ sequence: 5, entity: 'B', timestamp: fresh }]), 0)
    expect(await journal.reconcile([{ entity: 'A' }], '4')).toEqual({ cursor: '5', changed: false })
    expect(await journal.reconcile([{ entity: 'B' }], '4')).toEqual({ cursor: '5', changed: true })
  })

  it('invalidates a future cursor even when the database is empty after a restore', async () => {
    const journal = new SqlChangeJournal(fakeStorage([]), 0)
    expect(await journal.reconcile([{ entity: 'A' }], '12')).toEqual({ cursor: '0', changed: true })
    expect(await journal.reconcile([{ entity: 'A' }], '0')).toEqual({ cursor: '0', changed: false })
  })

  it('advances empty dependencies and ignores unrelated entities at the current cursor', async () => {
    const journal = new SqlChangeJournal(fakeStorage([{ sequence: 1, entity: 'B', timestamp: fresh }]), 0)
    expect(await journal.reconcile([], '0')).toEqual({ cursor: '1', changed: false })
    expect(await journal.reconcile([{ entity: 'A' }], '0')).toEqual({ cursor: '1', changed: false })
    expect(await journal.reconcile([{ entity: 'B' }], '1')).toEqual({ cursor: '1', changed: false })
  })
})
