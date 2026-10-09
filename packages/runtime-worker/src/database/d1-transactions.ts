import { SqlChangeJournal, changeJournalSchema, resolveLiveConfig, CHANGE_TABLE } from '@zebric/runtime-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Blueprint, SqlStoragePort, CommandEffectsPort } from '@zebric/runtime-core'
import { D1RuntimeJournal } from '../audit/d1-runtime-journal.js'
import { D1Adapter } from './d1-adapter.js'
import { D1WorkflowOutbox, type WorkflowEventIntent } from '../workflows/d1-workflow-outbox.js'

type Statement = { sql: string; params?: unknown[] }
type Table = {
  name: string
  sql: string
  columns: string[]
  writable: string[]
  work: string
  baseline: string
  schema: string
  sequence?: number | null
}
type Scope = {
  tables: Table[]
  statements: Statement[]
  effects: Array<() => Promise<void> | void>
  closed: boolean
  deadline: number
  pending: Promise<unknown>
}
export type TransactionReceipt = { key: string; fingerprint: string }

export class D1TransactionConflict extends Error {
  constructor() {
    super('Transaction conflicted with a concurrent database change; retry the request')
  }
}
export class D1IdempotencyConflict extends Error {
  constructor() {
    super('Idempotency key was reused with different input')
  }
}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`
const receiptTable = '_zebric_command_receipts'
const workspaceTable = '_zebric_transaction_workspaces'
const transactionLifetime = 5 * 60 * 1000

/**
 * Evaluate database-only operations against isolated tables, then validate the
 * snapshot and replay their writes in one D1 batch. No application write escapes
 * before commit. Whole-table validation also detects policy reads and phantoms.
 */
export class D1Transactions implements SqlStoragePort {
  private changeReady?: Promise<void>
  readonly changeJournal: SqlChangeJournal
  async initializeChanges(): Promise<void> {
    this.changeReady ??= this.db.query(changeJournalSchema()).then(() => undefined).catch(error => { this.changeReady = undefined; throw error })
    await this.changeReady
  }

  async enqueueChange(entity: string, operation: 'create' | 'update' | 'delete', id: string): Promise<void> {
    await this.initializeChanges()
    const statement = this.changeJournal.prepare(entity, operation, id)
    const scope = this.scopes.getStore()
    if (!scope) throw new Error('Changes require an active transaction')
    this.assertActive(scope)
    scope.statements.push(statement)
  }

  private readonly scopes = new AsyncLocalStorage<Scope>()
  private readonly outbox: D1WorkflowOutbox
  private readonly journal: D1RuntimeJournal

  constructor(
    private readonly db: D1Adapter,
    private readonly blueprint: Blueprint
  ) {
    this.changeJournal = new SqlChangeJournal(db, resolveLiveConfig(blueprint).changeRetentionMs)
    this.outbox = new D1WorkflowOutbox(db)
    this.journal = new D1RuntimeJournal(db)
    if (blueprint.entities.some((entity) => entity.name.toLowerCase().startsWith('_zebric_')))
      throw new Error('Entity names beginning with _zebric_ are reserved for runtime storage')
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const scope = this.scopes.getStore()
    if (!scope) return this.db.query<T>(sql, params)
    this.assertActive(scope)
    const operation = scope.pending.then(() => this.scopedQuery<T>(scope, sql, params))
    scope.pending = operation.catch(() => undefined)
    return operation
  }

  private async scopedQuery<T>(scope: Scope, sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.assertActive(scope)
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql))
      throw new Error('Only entity reads and mutations are supported inside a D1 transaction')
    const insert = /^\s*INSERT\s+INTO\s+"((?:[^"]|"")+)"/i.exec(sql)
    const workingSql = this.rewrite(sql, scope.tables)
    const result = await this.db.query<Record<string, unknown>>(
      insert && !/\bRETURNING\b/i.test(sql) ? `${workingSql} RETURNING *` : workingSql,
      params
    )
    if (insert) {
      const table = scope.tables.find(
        (table) => table.name.toLowerCase() === insert[1]!.replaceAll('""', '"').toLowerCase()
      )!
      // Freeze defaults and generated IDs so the committed row matches the row
      // used by subsequent reads, policies, and the stored command response.
      for (const row of result.rows)
        scope.statements.push({
          sql: `INSERT INTO ${quote(table.name)} (${table.writable.map(quote).join(', ')}) VALUES (${table.writable.map(() => '?').join(', ')})`,
          params: table.writable.map((column) =>
            Array.isArray(row[column]) ? new Uint8Array(row[column] as number[]) : row[column]
          )
        })
    } else if (/^\s*(UPDATE|DELETE)\b/i.test(sql)) {
      scope.statements.push({ sql, params })
    } else if (!/^\s*SELECT\b/i.test(sql)) {
      throw new Error('Only entity reads and mutations are supported inside a D1 transaction')
    }
    return result as { rows: T[] }
  }

  async batch<T = unknown>(statements: Statement[]): Promise<Array<{ rows: T[] }>> {
    if (!this.scopes.getStore()) return this.db.batch<T>(statements)
    const results: Array<{ rows: T[] }> = []
    for (const statement of statements) {
      if (statement.sql.startsWith(`INSERT INTO ${CHANGE_TABLE} `)) {
        const scope = this.scopes.getStore()!
        this.assertActive(scope)
        scope.statements.push(statement)
        results.push({ rows: [] })
      } else results.push(await this.query<T>(statement.sql, statement.params))
    }
    return results
  }

  async afterCommit(effect: () => Promise<void> | void): Promise<void> {
    const scope = this.scopes.getStore()
    if (scope) {
      this.assertActive(scope)
      scope.effects.push(effect)
    } else await effect()
  }

  async enqueueWorkflowEvent(intent: WorkflowEventIntent, id?: string): Promise<void> {
    const scope = this.scopes.getStore()
    if (!scope) throw new Error('Workflow outbox intents require an active transaction')
    this.assertActive(scope)
    const statement = await this.outbox.prepare(intent, id)
    this.assertActive(scope)
    scope.statements.push(statement)
  }

  get inTransaction(): boolean { return Boolean(this.scopes.getStore()) }

  async enqueueCommandEffects(effects: Parameters<CommandEffectsPort['enqueue']>[0]): Promise<void> {
    const scope = this.scopes.getStore()
    if (!scope) throw new Error('Runtime journal entries require an active transaction')
    this.assertActive(scope)
    const statements = await this.journal.prepare(effects)
    this.assertActive(scope)
    scope.statements.push(...statements)
  }

  async persistRuntimeEffects(effects: Parameters<CommandEffectsPort['enqueue']>[0]): Promise<void> {
    if (this.inTransaction) await this.enqueueCommandEffects(effects)
    else {
      const statements = await this.journal.prepare(effects)
      if (statements.length) await this.db.batch(statements)
    }
  }

  async transaction<T>(operation: () => Promise<T>, receipt?: TransactionReceipt): Promise<T> {
    const parent = this.scopes.getStore()
    if (parent) {
      this.assertActive(parent)
      if (receipt) throw new Error('A durable receipt must be attached to the outer transaction')
      return operation()
    }
    if (receipt) {
      await this.db.query(
        `CREATE TABLE IF NOT EXISTS ${receiptTable} (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, value TEXT NOT NULL)`
      )
      const cached = await this.readReceipt<T>(receipt)
      if (cached.found) return cached.value!
    }
    const scope: Scope = {
      tables: [],
      statements: [],
      effects: [],
      closed: false,
      deadline: Date.now() + transactionLifetime,
      pending: Promise.resolve()
    }
    try {
      try {
        scope.tables = await this.snapshot()
      } catch (error) {
        if (String(error).includes('integer overflow')) throw new D1TransactionConflict()
        throw error
      }
      let value: T
      try {
        value = await this.scopes.run(scope, operation)
      } catch (error) {
        if (receipt) {
          const cached = await this.readReceipt<T>(receipt)
          if (cached.found) return cached.value!
        }
        throw error
      }
      await scope.pending
      this.assertActive(scope)
      scope.closed = true
      const guards = scope.tables.map((table) => {
        const columns = table.columns.map(quote).join(', ')
        const current = `SELECT ${columns}, COUNT(*) FROM ${quote(table.name)} GROUP BY ${columns}`
        const original = `SELECT ${columns}, COUNT(*) FROM ${quote(table.baseline)} GROUP BY ${columns}`
        return {
          sql: `SELECT CASE WHEN NOT EXISTS (${current} EXCEPT ${original}) AND NOT EXISTS (${original} EXCEPT ${current}) AND (SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?) = ? THEN 1 ELSE abs(-9223372036854775808) END`,
          params: [table.name, table.sql]
        }
      })
      const statements = [...scope.tables.map((table) => this.schemaGuard(table)), ...guards, ...scope.statements]
      if (receipt)
        statements.push({
          sql: `INSERT INTO ${receiptTable} VALUES (?, ?, ?)`,
          params: [receipt.key, receipt.fingerprint, JSON.stringify(value)]
        })
      try {
        if (statements.length) await this.db.batch(statements)
      } catch (error) {
        // A competing request may have committed the same command first. Its
        // response is authoritative even if our snapshot is now stale.
        if (receipt) {
          const cached = await this.readReceipt<T>(receipt)
          if (cached.found) return cached.value!
        }
        if (String(error).includes('integer overflow')) throw new D1TransactionConflict()
        throw error
      }
      for (const effect of scope.effects) await effect()
      return value
    } finally {
      scope.closed = true
      // A cleanup outage must not turn an already committed command into an
      // apparent failure. Expired manifests are reclaimed by later transactions.
      if (scope.tables.length) {
        try {
          await this.cleanup(scope.tables)
        } catch (error) {
          console.error('D1 transaction cleanup failed:', error)
        }
      }
    }
  }

  private async readReceipt<T>(receipt: TransactionReceipt): Promise<{ found: boolean; value?: T }> {
    const { rows } = await this.db.query<{ fingerprint: string; value: string }>(
      `SELECT fingerprint, value FROM ${receiptTable} WHERE key = ?`,
      [receipt.key]
    )
    if (!rows[0]) return { found: false }
    if (rows[0].fingerprint !== receipt.fingerprint) throw new D1IdempotencyConflict()
    return { found: true, value: JSON.parse(rows[0].value) as T }
  }

  private async snapshot(): Promise<Table[]> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS ${workspaceTable} (id TEXT PRIMARY KEY, tables_json TEXT NOT NULL, expires_at INTEGER NOT NULL)`
    )
    const { rows: abandoned } = await this.db.query<{ tables_json: string }>(
      `SELECT tables_json FROM ${workspaceTable} WHERE expires_at < ?`,
      [Date.now()]
    )
    for (const workspace of abandoned) await this.cleanup(JSON.parse(workspace.tables_json) as Table[])
    const prefix = `_zebric_tx_${crypto.randomUUID().replaceAll('-', '')}`
    const { rows: schema } = await this.db.query<{ type: string; name: string; tbl_name: string; sql: string | null }>(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')"
    )
    const tables: Table[] = []
    for (const entity of this.blueprint.entities) {
      const definition = schema.find(
        (entry) => entry.type === 'table' && entry.name.toLowerCase() === entity.name.toLowerCase()
      )
      if (!definition?.sql) throw new Error(`Transaction table does not exist: ${entity.name}`)
      if (
        /^CREATE\s+VIRTUAL/i.test(definition.sql) ||
        schema.some((entry) => entry.type === 'trigger' && entry.tbl_name.toLowerCase() === entity.name.toLowerCase())
      )
        throw new Error(`D1 transactions do not support virtual tables or custom triggers: ${entity.name}`)
      const { rows: columns } = await this.db.query<{ name: string; hidden: number }>(
        `PRAGMA table_xinfo(${quote(entity.name)})`
      )
      tables.push({
        name: definition.name,
        sql: definition.sql,
        columns: columns.map((column) => column.name),
        writable: columns.filter((column) => !column.hidden).map((column) => column.name),
        work: `${prefix}_${tables.length}`,
        baseline: `${prefix}_${tables.length}_base`,
        schema: JSON.stringify(
          schema
            .filter((entry) => entry.tbl_name === definition.name)
            .sort((a, b) => {
              const left = `${a.type}\0${a.name}`
              const right = `${b.type}\0${b.name}`
              return left < right ? -1 : left > right ? 1 : 0
            })
            .map((entry) => ({ type: entry.type, name: entry.name, sql: entry.sql }))
        )
      })
    }
    for (const table of tables.filter((table) => /\bAUTOINCREMENT\b/i.test(table.sql))) {
      const { rows } = await this.db.query<{ seq: number }>('SELECT seq FROM sqlite_sequence WHERE name = ?', [
        table.name
      ])
      table.sequence = rows[0]?.seq ?? null
    }
    const statements: Statement[] = [
      { sql: 'PRAGMA defer_foreign_keys = ON' },
      ...tables.map((table) => this.schemaGuard(table)),
      ...tables.map((table) => ({ sql: this.rewrite(table.sql, tables) }))
    ]
    for (const table of tables) {
      // No column affinity: preserve exact SQLite storage types, including ANY
      // columns in STRICT tables, instead of coercing values through CTAS types.
      statements.push({ sql: `CREATE TABLE ${quote(table.baseline)} (${table.columns.map(quote).join(', ')})` })
      statements.push({ sql: `INSERT INTO ${quote(table.baseline)} SELECT * FROM ${quote(table.name)}` })
      const columns = table.writable.map(quote).join(', ')
      statements.push({
        sql: `INSERT INTO ${quote(table.work)} (${columns}) SELECT ${columns} FROM ${quote(table.baseline)}`
      })
      if (table.sequence != null)
        statements.push({
          sql: 'UPDATE sqlite_sequence SET seq = ? WHERE name = ?',
          params: [table.sequence, table.work]
        })
      for (const index of schema.filter(
        (entry) => entry.type === 'index' && entry.tbl_name === table.name && entry.sql
      )) {
        const sql = index.sql!.replace(
          /^(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?:"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|\S+)/i,
          `$1${quote(`${prefix}_index_${statements.length}`)}`
        )
        statements.push({ sql: this.rewrite(sql, tables) })
      }
    }
    if (tables.length) {
      statements.push({
        sql: `INSERT INTO ${workspaceTable} VALUES (?, ?, ?)`,
        params: [tables[0]!.work, JSON.stringify(tables), Date.now() + transactionLifetime * 2]
      })
      await this.db.batch(statements)
    }
    return tables
  }

  private assertActive(scope: Scope): void {
    if (scope.closed) throw new Error('Transaction has already ended')
    if (Date.now() >= scope.deadline) throw new Error('D1 transaction exceeded its five minute lifetime')
  }

  private schemaGuard(table: Table): Statement {
    return {
      sql: `SELECT CASE WHEN (SELECT json_group_array(json_object('type', type, 'name', name, 'sql', sql)) FROM (SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('table', 'index', 'trigger') ORDER BY type, name)) = ? ${table.sequence !== undefined ? 'AND (SELECT seq FROM sqlite_sequence WHERE name = ?) IS ?' : ''} THEN 1 ELSE abs(-9223372036854775808) END`,
      params: [table.name, table.schema, ...(table.sequence !== undefined ? [table.name, table.sequence] : [])]
    }
  }

  private async cleanup(tables: Table[]): Promise<void> {
    if (!tables.length) return
    if (
      tables.some(
        (table) =>
          !/^_zebric_tx_[a-f0-9]{32}_\d+(?:_base)?$/.test(table.work) ||
          !/^_zebric_tx_[a-f0-9]{32}_\d+_base$/.test(table.baseline)
      )
    )
      throw new Error('Invalid transaction workspace manifest')
    await this.db.batch([
      { sql: 'PRAGMA defer_foreign_keys = ON' },
      ...tables.flatMap((table) => [
        { sql: `DROP TABLE IF EXISTS ${quote(table.work)}` },
        { sql: `DROP TABLE IF EXISTS ${quote(table.baseline)}` }
      ]),
      { sql: `DELETE FROM ${workspaceTable} WHERE id = ?`, params: [tables[0]!.work] }
    ])
  }

  /** Rewrite table tokens only; quoted strings, comments and field names survive. */
  private rewrite(sql: string, tables: Table[]): string {
    const tokens =
      sql.match(
        /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\s+|./g
      ) ?? []
    const schemaStatement = /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i.test(sql)
    let tableNext = false
    return tokens
      .map((token) => {
        if (/^\s|^--|^\/\*/.test(token)) return token
        if (tableNext) {
          tableNext = false
          const name = token.startsWith('"')
            ? token.slice(1, -1).replaceAll('""', '"')
            : /^[`[]/.test(token)
              ? token.slice(1, -1)
              : token
          const table = tables.find((table) => table.name.toLowerCase() === name.toLowerCase())
          if (!table) throw new Error(`Transaction SQL references an unsupported table: ${name}`)
          return quote(table.work)
        }
        if (
          (schemaStatement ? /^(TABLE|REFERENCES)$/i : /^(FROM|JOIN|UPDATE|INTO)$/i).test(token) ||
          (token.toUpperCase() === 'ON' && /^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(sql))
        )
          tableNext = true
        return token
      })
      .join('')
  }
}
