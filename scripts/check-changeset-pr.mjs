import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function getPublishedPackages() {
  const packagesDir = join(process.cwd(), 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const published = new Map()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const packageDir = join(packagesDir, entry.name)
    const packageJsonPath = join(packageDir, 'package.json')

    try {
      const pkg = await readJson(packageJsonPath)
      if (!pkg.private) {
        published.set(`packages/${entry.name}/`, pkg.name ?? entry.name)
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }

  return published
}

async function getChangedFiles(baseRef) {
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-only', `${baseRef}...HEAD`],
    { cwd: process.cwd() }
  )

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function getChangesetFiles() {
  const changesetDir = join(process.cwd(), '.changeset')
  const entries = await readdir(changesetDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
}

async function main() {
  const baseRef = process.argv[2]
  if (!baseRef) {
    throw new Error('Usage: node scripts/check-changeset-pr.mjs <base-ref>')
  }

  const publishedPackages = await getPublishedPackages()
  const changedFiles = await getChangedFiles(baseRef)
  const changedPublishedPackages = new Set()

  for (const file of changedFiles) {
    for (const [prefix, packageName] of publishedPackages.entries()) {
      if (file.startsWith(prefix)) {
        changedPublishedPackages.add(packageName)
      }
    }
  }

  if (changedPublishedPackages.size === 0) {
    console.log('No published package changes detected')
    return
  }

  const changesetFiles = await getChangesetFiles()
  if (changesetFiles.length > 0) {
    console.log(`Changeset present for published package changes: ${changesetFiles.join(', ')}`)
    return
  }

  console.error('Published packages changed without a changeset:')
  for (const packageName of changedPublishedPackages) {
    console.error(`- ${packageName}`)
  }
  console.error('Run `pnpm changeset` or `pnpm changeset add --empty` and commit the result.')
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
