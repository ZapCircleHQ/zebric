import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'

describe('portable services inside workerd', () => {
  let mf: Miniflare
  let output: string
  beforeAll(async () => {
    output = await mkdtemp(join(tmpdir(), 'zebric-platform-test-'))
    await promisify(execFile)(process.execPath, [new URL(import.meta.resolve('wrangler')).pathname, 'deploy',
      'tests/fixtures/platform-worker.ts', '--dry-run', '--outdir', output, '--name', 'zebric-platform-test',
      '--compatibility-date', '2026-04-28', '--compatibility-flags', 'nodejs_compat'],
    { cwd: new URL('../..', import.meta.url).pathname, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } })
    mf = new Miniflare({ modulesRoot: output, modules: [{ type: 'ESModule', path: join(output, 'platform-worker.js') }],
      compatibilityDate: '2026-04-28', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'platform' }, r2Buckets: { FILES: 'files' } })
    await (await mf.getD1Database('DB')).exec('CREATE TABLE Item (id TEXT PRIMARY KEY, title TEXT)')
  })
  afterAll(async () => {
    await mf?.dispose()
    if (output) await rm(output, { recursive: true, force: true })
  })
  it('initializes a bundled plugin, serves R2 files, and executes advertised bundled handlers', async () => {
    const discovery = await (await mf.dispatchFetch('https://app.example/.well-known/zebric-agent.json')).json() as any
    expect(discovery.commands).toEqual([expect.objectContaining({ name: 'ChangeTitle' })])
    expect(await (await mf.dispatchFetch('https://app.example/uploads/note.txt')).text()).toBe('workerd')
    const result = await mf.dispatchFetch('https://app.example/api/commands/change_title/init', { method: 'POST',
      headers: { cookie: 'csrf-token=smoke', 'x-csrf-token': 'smoke', 'content-type': 'application/json' }, body: '{}' })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ record: { id: 'init', title: 'Handled' } })
    const metrics = await (await mf.dispatchFetch('https://app.example/metrics')).text()
    expect(metrics).toContain('zbl_query_duration_ms_count{entity="Item"}')
    const audit = await (await mf.getD1Database('DB')).prepare('SELECT COUNT(*) AS count FROM _zebric_audit').first<{ count: number }>()
    expect(audit!.count).toBeGreaterThan(0)
  })
})
