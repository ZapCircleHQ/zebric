import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditCommand } from './audit.js'

describe('auditCommand', () => {
  let directory: string
  let blueprint: string
  const previousExitCode = process.exitCode

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'zebric-audit-'))
    blueprint = join(directory, 'blueprint.json')
    await writeFile(blueprint, JSON.stringify({
      version: '1.0.0', project: { name: 'Audit', version: '1.0.0', runtime: { min_version: '0.3.0' } },
      entities: [{ name: 'Task', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }],
      pages: [],
    }))
    process.exitCode = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    process.exitCode = previousExitCode
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('prints parseable JSON and only fails on the selected severity threshold', async () => {
    await auditCommand({ blueprint, format: 'json' })
    const report = JSON.parse(vi.mocked(console.log).mock.calls[0]![0])
    expect(report.summary.warning).toBe(1)
    expect(process.exitCode).toBe(0)
    await auditCommand({ blueprint, failOn: 'warning' })
    expect(process.exitCode).toBe(1)
  })

  it('writes and checks snapshots semantically, detecting removed findings too', async () => {
    const snapshot = join(directory, 'audit.json')
    await auditCommand({ blueprint, output: snapshot })
    const report = JSON.parse(await readFile(snapshot, 'utf8'))
    await writeFile(snapshot, JSON.stringify(report))
    await auditCommand({ blueprint, check: snapshot })
    expect(process.exitCode).toBe(0)
    report.findings = []
    await writeFile(snapshot, JSON.stringify(report))
    await auditCommand({ blueprint, check: snapshot })
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenLastCalledWith(expect.stringContaining('snapshot differs'))
  })

  it('fails on missing or malformed snapshots and conflicting options', async () => {
    const snapshot = join(directory, 'audit.json')
    await auditCommand({ blueprint, check: snapshot })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
    await writeFile(snapshot, '{bad')
    await auditCommand({ blueprint, check: snapshot })
    expect(process.exitCode).toBe(1)
    await auditCommand({ blueprint, check: snapshot, output: snapshot })
    expect(console.error).toHaveBeenLastCalledWith(expect.stringContaining('cannot be combined'))
    expect(await readFile(snapshot, 'utf8')).toBe('{bad')
  })

  it('fails validation before writing a report, even with fail-on none', async () => {
    await writeFile(blueprint, '{}')
    await auditCommand({ blueprint, failOn: 'none', output: join(directory, 'audit.json') })
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenLastCalledWith(expect.stringContaining('Blueprint validation failed'))
    await expect(readFile(join(directory, 'audit.json'))).rejects.toThrow()
  })

  it('reports load errors as failures', async () => {
    await auditCommand({ blueprint: join(directory, 'missing.toml') })
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenLastCalledWith(expect.stringContaining('Failed to audit blueprint'))
  })
})
