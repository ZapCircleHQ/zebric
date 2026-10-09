import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blueprint, session } from '../../../../tests/runtime-conformance/contracts.js'
import { DatabaseConnection } from './connection.js'
import { QueryExecutor } from './query-executor.js'

let root: string
let connection: DatabaseConnection

afterEach(async () => {
  await connection?.close()
  if (root) await rm(root, { recursive: true, force: true })
})

it('reconciles an old render cursor after reopening the durable Node database', async () => {
  root = await mkdtemp(join(tmpdir(), 'zebric-live-restart-'))
  const config = { type: 'sqlite' as const, filename: join(root, 'app.db') }
  connection = new DatabaseConnection(config, blueprint)
  await connection.connect()
  let queries = new QueryExecutor(connection)
  const cursor = await queries.liveChanges.currentCursor()
  await queries.create('Item', { id: 'offline' }, { session })
  await connection.close()
  connection = new DatabaseConnection(config, blueprint)
  await connection.connect()
  queries = new QueryExecutor(connection)
  expect(await queries.liveChanges.reconcile([{ entity: 'Item' }], cursor)).toMatchObject({ changed: true })
  const current = await queries.liveChanges.currentCursor()
  await queries.delete('Item', 'offline', { session })
  expect(await queries.liveChanges.reconcile([{ entity: 'Item' }], current)).toMatchObject({ changed: true })
})
