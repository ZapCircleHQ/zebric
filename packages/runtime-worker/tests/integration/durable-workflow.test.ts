import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'

// Wrangler bundles the real entrypoint, including cloudflare:workers imports.
// This catches platform restrictions that a mocked step runner cannot reproduce.
describe('Cloudflare Workflows integration', () => {
  let mf: Miniflare
  let output: string
  beforeAll(async () => {
    output = await mkdtemp(join(tmpdir(), 'zebric-durable-test-'))
    const wrangler = new URL(import.meta.resolve('wrangler')).pathname
    await promisify(execFile)(
      process.execPath,
      [
        wrangler,
        'deploy',
        'tests/fixtures/durable-worker.ts',
        '--dry-run',
        '--outdir',
        output,
        '--name',
        'zebric-durable-test',
        '--compatibility-date',
        '2026-04-28',
        '--compatibility-flags',
        'nodejs_compat'
      ],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
      }
    )
    mf = new Miniflare({
      modulesRoot: output,
      modules: [{ type: 'ESModule', path: join(output, 'durable-worker.js') }],
      compatibilityDate: '2026-04-28',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'durable-test' },
      bindings: { AGENT_KEY: 'secret' },
      workflows: { WORKFLOWS: { name: 'durable-test', className: 'TestWorkflow' } }
    })
    const db = await mf.getD1Database('DB')
    await db.exec(
      'CREATE TABLE Item (id TEXT PRIMARY KEY, count INTEGER); CREATE TABLE attempts (count INTEGER); INSERT INTO attempts VALUES (0); CREATE TABLE recovery (count INTEGER); INSERT INTO recovery VALUES (0);'
    )
  }, 30000)
  afterAll(async () => {
    await mf?.dispose()
    if (output) await rm(output, { recursive: true, force: true })
  })

  it('persists typed step results, durably sleeps, and retries only the failing effect', async () => {
    const response = await mf.dispatchFetch('https://edge.example/start')
    expect(response.status).toBe(200)
    const job = (await response.json()) as any
    expect(job.status).toBe('pending')
    let observed: any
    await expect
      .poll(
        async () => {
          const result = await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)
          observed = await result.json()
          return observed.status
        },
        { timeout: 15000, interval: 100 }
      )
      .toBe('completed')
    expect(observed.result.sent).toEqual({ count: 7, attempts: 2 })
    const db = await mf.getD1Database('DB')
    expect(await db.prepare('SELECT count(*) AS count FROM Item').first()).toEqual({ count: 1 })
  })
  it('executes a read-dependent transaction through the native Workflow entrypoint', async () => {
    const job = (await (await mf.dispatchFetch('https://edge.example/start?workflow=Atomic')).json()) as any
    let observed: any
    await expect
      .poll(
        async () => {
          observed = await (await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)).json()
          return observed.status
        },
        { timeout: 10000, interval: 100 }
      )
      .toBe('completed')
    expect(observed.result.changed.count).toBe(11)
    const db = await mf.getD1Database('DB')
    expect(await db.prepare('SELECT count FROM Item WHERE id = ?').bind('atomic-dependent').first()).toEqual({
      count: 11
    })
  })

  it('replays durable HTTP command responses across fresh Worker engines', async () => {
    const db = await mf.getD1Database('DB')
    await db.prepare('INSERT INTO Item VALUES (?, ?)').bind('http-command', 0).run()
    const request = (count: number) =>
      mf.dispatchFetch('https://edge.example/api/commands/change_count/http-command', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
          'x-agent-run-id': 'run',
          'idempotency-key': 'http-command-key'
        },
        body: JSON.stringify({ count })
      })
    const first = await request(9)
    expect(first.status).toBe(200)
    const result = await first.json()
    await db.prepare('UPDATE Item SET count = 55 WHERE id = ?').bind('http-command').run()
    const replay = await request(9)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(result)
    expect((await request(10)).status).toBe(409)
    expect(await db.prepare('SELECT count FROM Item WHERE id = ?').bind('http-command').first()).toEqual({ count: 55 })
    await expect
      .poll(async () => db.prepare('SELECT count FROM Item WHERE id = ?').bind('command-child').first(), {
        timeout: 10000,
        interval: 100
      })
      .toEqual({ count: 9 })
  })

  it('terminates a durably sleeping instance without executing later effects', async () => {
    const job = (await (await mf.dispatchFetch('https://edge.example/start?workflow=Slow')).json()) as any
    await expect
      .poll(
        async () => {
          const observed = (await (await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)).json()) as any
          return observed.status
        },
        { timeout: 5000, interval: 100 }
      )
      .toBe('running')
    expect(await (await mf.dispatchFetch(`https://edge.example/cancel?id=${job.id}`)).json()).toEqual({ changed: true })
    const cancelled = (await (await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)).json()) as any
    expect(cancelled.status).toBe('cancelled')
    const db = await mf.getD1Database('DB')
    expect(await db.prepare('SELECT count FROM attempts').first()).toEqual({ count: 2 })
  })

  it('restarts a failed native instance under the same job identity', async () => {
    const job = (await (await mf.dispatchFetch('https://edge.example/start?workflow=Recoverable')).json()) as any
    await expect
      .poll(
        async () => {
          const observed = (await (await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)).json()) as any
          return observed.status
        },
        { timeout: 5000, interval: 100 }
      )
      .toBe('failed')
    expect(await (await mf.dispatchFetch(`https://edge.example/retry?id=${job.id}`)).json()).toEqual({ changed: true })
    let observed: any
    await expect
      .poll(
        async () => {
          observed = await (await mf.dispatchFetch(`https://edge.example/poll?id=${job.id}`)).json()
          return observed.status
        },
        { timeout: 5000, interval: 100 }
      )
      .toBe('completed')
    expect(observed.id).toBe(job.id)
    expect(observed.result.sent).toEqual({ recovered: true })
  })
})
