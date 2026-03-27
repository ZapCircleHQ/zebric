import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function readJson(path) {
  const contents = await readFile(path, 'utf8')
  return JSON.parse(contents)
}

async function main() {
  const packagesDir = join(process.cwd(), 'packages')
  const packageDirs = await readdir(packagesDir, { withFileTypes: true })
  const publishedPackages = []
  const mismatches = []

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) continue

    const packagePath = join(packagesDir, entry.name, 'package.json')

    try {
      const pkg = await readJson(packagePath)
      if (pkg.private) continue
      publishedPackages.push({
        name: pkg.name ?? entry.name,
        path: packagePath,
        version: pkg.version ?? '(missing)',
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }

  const versions = new Set(publishedPackages.map((pkg) => pkg.version))
  if (versions.size > 1) {
    const expectedVersion = publishedPackages[0]?.version ?? '(missing)'
    for (const pkg of publishedPackages) {
      if (pkg.version !== expectedVersion) {
        mismatches.push(pkg)
      }
    }
  }

  if (mismatches.length > 0) {
    console.error('Release version mismatch across published packages:')
    for (const pkg of publishedPackages) {
      console.error(`- ${pkg.name} (${pkg.version}) -> ${pkg.path}`)
    }
    process.exit(1)
  }

  if (publishedPackages.length === 0) {
    throw new Error('No published packages found under packages/')
  }

  console.log(`Release versions aligned at ${publishedPackages[0].version}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
