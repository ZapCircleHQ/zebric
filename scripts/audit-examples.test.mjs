import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditExamples } from './audit-examples.mjs'

test('example checkpoint discovers variants and rejects added, changed, removed, missing, and invalid results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zebric-example-audit-'))
  try {
    const example = join(directory, 'app')
    await mkdir(example)
    const bp = {
      version: '1.0.0', project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.3.0' } },
      entities: [{ name: 'Item', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }], pages: [],
    }
    const blueprint = join(example, 'blueprint.json')
    const snapshotPath = join(example, 'audit.json')
    await writeFile(blueprint, JSON.stringify(bp))
    await assert.rejects(auditExamples({ examplesDir: directory }), /audit.json/)
    await auditExamples({ examplesDir: directory, update: true })
    assert.equal(await auditExamples({ examplesDir: directory }), 1)
    const original = await readFile(snapshotPath, 'utf8')
    const snapshot = JSON.parse(original)
    snapshot.blueprints[0].report.findings[0].message = 'changed'
    await writeFile(snapshotPath, JSON.stringify(snapshot))
    await assert.rejects(auditExamples({ examplesDir: directory }), /differs/)
    await writeFile(snapshotPath, original)
    bp.entities[0].access = { read: false, create: false, update: false, delete: false }
    await writeFile(blueprint, JSON.stringify(bp))
    await assert.rejects(auditExamples({ examplesDir: directory }), /differs/)
    await auditExamples({ examplesDir: directory, update: true })
    await writeFile(join(example, 'blueprint-alternate.json'), JSON.stringify(bp))
    await assert.rejects(auditExamples({ examplesDir: directory }), /differs/)
    await auditExamples({ examplesDir: directory, update: true })
    assert.equal(JSON.parse(await readFile(snapshotPath, 'utf8')).blueprints.length, 2)
    await rm(join(example, 'blueprint-alternate.json'))
    await assert.rejects(auditExamples({ examplesDir: directory }), /differs/)
    await writeFile(blueprint, '{}')
    const before = await readFile(snapshotPath, 'utf8')
    await assert.rejects(auditExamples({ examplesDir: directory, update: true }), /validation failed/)
    assert.equal(await readFile(snapshotPath, 'utf8'), before)
    await rm(blueprint)
    await assert.rejects(auditExamples({ examplesDir: directory }), /no root blueprint/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
