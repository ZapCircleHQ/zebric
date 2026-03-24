import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function readJson(path) {
  const contents = await readFile(path, 'utf8')
  return JSON.parse(contents)
}

async function main() {
  const rootPath = join(process.cwd(), 'package.json')
  const rootPackage = await readJson(rootPath)
  const expectedVersion = rootPackage.version

  if (!expectedVersion) {
    throw new Error('Root package.json is missing a version field')
  }

  const packagesDir = join(process.cwd(), 'packages')
  const packageDirs = await readdir(packagesDir, { withFileTypes: true })
  const mismatches = []

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue

    const packagePath = join(packagesDir, entry.name, 'package.json')

    try {
      const pkg = await readJson(packagePath)
      if (pkg.private) continue

      if (pkg.version !== expectedVersion) {
        mismatches.push({
          name: pkg.name ?? entry.name,
          path: packagePath,
          version: pkg.version ?? '(missing)',
        })
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }

  if (mismatches.length > 0) {
    console.error(`Release version mismatch: expected ${expectedVersion}`)
    for (const mismatch of mismatches) {
      console.error(`- ${mismatch.name} (${mismatch.version}) -> ${mismatch.path}`)
    }
    process.exit(1)
  }

  console.log(`Release versions aligned at ${expectedVersion}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
