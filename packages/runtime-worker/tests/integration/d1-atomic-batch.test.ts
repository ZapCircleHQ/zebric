import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { D1Adapter } from '../../src/database/d1-adapter.js'

describe('D1 atomic batch', () => {
  let mf: Miniflare
  let adapter: D1Adapter

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'd1:transaction-test' },
    })
    adapter = new D1Adapter(await mf.getD1Database('DB'))
    await adapter.query('CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  })

  afterAll(async () => {
    await mf?.dispose()
  })

  it('commits every statement in a successful batch', async () => {
    await adapter.batch([
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['success-1', 'one'] },
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['success-2', 'two'] },
    ])
    const result = await adapter.query('SELECT id FROM records WHERE id LIKE ?', ['success-%'])
    expect(result.rows).toHaveLength(2)
  })

  it('rolls back every statement when one batch statement fails', async () => {
    await adapter.query('INSERT INTO records VALUES (?, ?)', ['collision', 'existing'])

    await expect(adapter.batch([
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['rolled-back', 'temporary'] },
      { sql: 'INSERT INTO records VALUES (?, ?)', params: ['collision', 'duplicate'] },
    ])).rejects.toThrow()

    const result = await adapter.query('SELECT id FROM records WHERE id = ?', ['rolled-back'])
    expect(result.rows).toEqual([])
  })
})
