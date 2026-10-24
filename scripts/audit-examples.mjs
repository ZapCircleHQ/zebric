import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify, isDeepStrictEqual } from 'node:util'
import { execFile } from 'node:child_process'

const execute = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Discover applications rather than relying on a hand-maintained CI allow-list. */
export async function auditExamples({ examplesDir = join(root, 'examples'), update = false, cli = join(root, 'packages/cli/dist/index.js') } = {}) {
  const directories = (await readdir(examplesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__'))
    .map(entry => entry.name).sort()
  const failures = []
  let checked = 0
  for (const directory of directories) {
    const exampleDir = join(examplesDir, directory)
    const files = (await readdir(exampleDir)).filter(name => /^blueprint[^/]*\.(toml|json)$/.test(name)).sort()
    if (!files.length) {
      failures.push(`${directory}: no root blueprint*.toml or blueprint*.json found`)
      continue
    }
    try {
      const blueprints = []
      for (const file of files) {
        const { stdout } = await execute(process.execPath, [cli, 'audit', '--blueprint', join(exampleDir, file), '--format', 'json', '--fail-on', 'none'], { maxBuffer: 10 * 1024 * 1024 })
        blueprints.push({ path: file, report: JSON.parse(stdout) })
      }
      const snapshot = { version: 1, blueprints }
      const snapshotPath = join(exampleDir, 'audit.json')
      if (update) {
        await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`)
      } else {
        const expected = JSON.parse(await readFile(snapshotPath, 'utf8'))
        if (!isDeepStrictEqual(expected, snapshot)) throw new Error('audit.json differs; review changes and run pnpm audit:examples:update')
      }
      checked++
      console.log(`${update ? 'Updated' : 'Verified'} ${directory}/audit.json (${files.length} blueprints)`)
    } catch (error) {
      failures.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!directories.length) failures.push('No example applications found')
  if (failures.length) throw new Error(failures.join('\n'))
  return checked
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--update')) {
    console.error('Usage: node scripts/audit-examples.mjs [--update]')
    process.exitCode = 1
  } else {
    try {
      await auditExamples({ update: args.includes('--update') })
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
