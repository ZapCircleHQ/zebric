import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BlueprintParser,
  DatabaseConnection,
  createZebric,
} from '../../packages/runtime-node/dist/index.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
export const benchmarkRoot = resolve(thisDir, '..')
export const blueprintPath = resolve(benchmarkRoot, 'app/blueprint.toml')
export const defaultResultsDir = resolve(benchmarkRoot, 'results')
export const defaultDataDir = resolve(benchmarkRoot, 'data')

export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

export function loadBlueprint() {
  const parser = new BlueprintParser()
  const content = readFileSync(blueprintPath, 'utf8')
  return parser.parse(content, 'toml', blueprintPath)
}

export function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    return {
      kind: 'sqlite',
      config: { type: 'sqlite', filename: resolve(defaultDataDir, 'big-zebra.db') },
    }
  }

  if (databaseUrl.startsWith('sqlite://')) {
    return {
      kind: 'sqlite',
      config: { type: 'sqlite', filename: databaseUrl.replace('sqlite://', '') },
    }
  }

  if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
    return {
      kind: 'postgres',
      config: { type: 'postgres', url: databaseUrl },
    }
  }

  throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`)
}

export async function openBenchmarkDatabase(databaseUrl) {
  const blueprint = loadBlueprint()
  const { kind, config } = parseDatabaseUrl(databaseUrl)
  ensureDir(defaultDataDir)
  const connection = new DatabaseConnection(config, blueprint)
  await connection.connect()
  return { blueprint, connection, kind }
}

export function resetSqliteFile(databaseUrl) {
  const { kind, config } = parseDatabaseUrl(databaseUrl)
  if (kind !== 'sqlite') {
    return
  }
  if (existsSync(config.filename)) {
    rmSync(config.filename, { force: true })
  }
}

export async function startLocalApp({
  port = 3200,
  host = '127.0.0.1',
  databaseUrl,
}) {
  const zebric = await createZebric({
    blueprintPath,
    port,
    host,
    databaseUrl,
    dev: true,
    devConfig: {
      hotReload: false,
      rateLimit: {
        max: 1_000_000,
        windowMs: 60_000,
      },
    },
    validateBeforeStart: true,
    logLevel: 'info',
  })

  return zebric
}

export function nowIso() {
  return new Date().toISOString()
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export function snakeCase(input) {
  return input.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
}

export function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
