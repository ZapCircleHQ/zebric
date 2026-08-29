import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const runtimeCoreRoot = join(repositoryRoot, 'packages/runtime-core')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'zebric-agent-package-'))
const artifactsRoot = join(temporaryRoot, 'artifacts')
const consumerRoot = join(temporaryRoot, 'consumer')
const agentPackage = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

try {
  mkdirSync(artifactsRoot)
  mkdirSync(consumerRoot)
  runPnpm(['pack', '--pack-destination', artifactsRoot], packageRoot)
  runPnpm(['pack', '--pack-destination', artifactsRoot], runtimeCoreRoot)

  const agentTarball = findTarball(artifactsRoot, `zebric-agent-${agentPackage.version}`)
  const runtimeCoreTarball = findTarball(artifactsRoot, 'zebric-runtime-core-')
  const contents = output('tar', ['-tzf', agentTarball])
  assert.doesNotMatch(contents, /\.test\.(js|d\.ts)(\.map)?$/m, 'package must not contain compiled tests')
  assert.match(contents, /^package\/dist\/cli\/index\.js$/m, 'package must contain the CLI binary')
  assert.match(contents, /^package\/dist\/index\.d\.ts$/m, 'package must contain root declarations')

  writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({
    name: 'zebric-agent-package-smoke',
    private: true,
    type: 'module',
    dependencies: {
      '@zebric/agent': `file:${agentTarball}`,
      '@zebric/runtime-core': `file:${runtimeCoreTarball}`,
    },
  }, null, 2))
  writeFileSync(join(consumerRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      lib: ['ES2023', 'ESNext.Disposable', 'DOM', 'DOM.Iterable'],
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['consumer.ts'],
  }, null, 2))
  writeFileSync(join(consumerRoot, 'consumer.ts'), `
import { ZebricAgentExitCode, createZebricAgent, validateBlueprint } from '@zebric/agent'

const exitCode: number = ZebricAgentExitCode.success
const validator: typeof validateBlueprint = validateBlueprint
const factory: typeof createZebricAgent = createZebricAgent
void [exitCode, validator, factory]
`)
  writeFileSync(join(consumerRoot, 'consumer.mjs'), `
import { ZebricAgentExitCode, createZebricAgent, validateBlueprint } from '@zebric/agent'
if (ZebricAgentExitCode.success !== 0) throw new Error('Unexpected success exit code')
if (typeof createZebricAgent !== 'function') throw new Error('Missing createZebricAgent export')
if (typeof validateBlueprint !== 'function') throw new Error('Missing validateBlueprint export')
`)
  writeFileSync(join(consumerRoot, 'blueprint.toml'), `
version = "0.1.0"

[project]
name = "Package Smoke Test"
version = "1.0.0"

[project.runtime]
min_version = "0.1.0"

[entity.Item]
fields = [{ name = "id", type = "ULID", primary_key = true }]

[page."/"]
title = "Package Smoke Test"
`)

  const installArguments = ['install', '--frozen-lockfile=false', '--ignore-scripts']
  if (process.env.ZEBRIC_PACKAGE_SMOKE_OFFLINE === '1') installArguments.push('--offline')
  runPnpm(installArguments, consumerRoot, {
    CI: 'true',
  })
  run('node', ['consumer.mjs'], consumerRoot)
  run(join(packageRoot, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], consumerRoot)
  const cliOutput = output(join(consumerRoot, 'node_modules/.bin/zebric-agent'), [
    'validate', 'blueprint.toml', '--workspace', consumerRoot, '--json',
  ], consumerRoot)
  const parsed = JSON.parse(cliOutput)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.command, 'validate')
  assert.equal(parsed.result.project.name, 'Package Smoke Test')

  process.stdout.write('Zebric Agent package smoke test passed.\n')
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function findTarball(directory, prefix) {
  const listing = readdirSync(directory)
    .filter(name => name.startsWith(prefix) && name.endsWith('.tgz'))
    .map(name => join(directory, name))
  assert.equal(listing.length, 1, `Expected one ${prefix} tarball`)
  return listing[0]
}

function run(command, args, cwd = repositoryRoot, extraEnv = {}) {
  execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      // pnpm may spawn a dependency-status install. Keep the explicitly selected
      // package-manager fallback policy in that child process as well.
      pnpm_config_pm_on_fail: 'ignore',
      ...extraEnv,
    },
    stdio: 'pipe',
    encoding: 'utf8',
  })
}

function runPnpm(args, cwd = repositoryRoot, extraEnv = {}) {
  try {
    run('pnpm', args, cwd, extraEnv)
  } catch (error) {
    const stderr = String(error?.stderr ?? '')
    if (!stderr.includes('PNPM_ENGINE_IDENTITY_') && !stderr.includes('registry signature could not be verified')) {
      throw error
    }
    // Newer pnpm versions can manage the packageManager version themselves and
    // may need this global fallback when the registry is unavailable. Pinned
    // pnpm versions that do not recognize the option never see this retry.
    run('pnpm', ['--pm-on-fail=ignore', ...args], cwd, extraEnv)
  }
}

function output(command, args, cwd = repositoryRoot) {
  return execFileSync(command, args, {
    cwd,
    env: { ...process.env, pnpm_config_pm_on_fail: 'ignore' },
    stdio: 'pipe',
    encoding: 'utf8',
  })
}
