import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { withExample } from '../security-test-helpers.mjs'

const run = promisify(execFile)
test('Idea to Operations complete seeded lifecycle', { timeout: 240000 }, () =>
  withExample('idea-to-operations', 6, async app => {
    await app.seed('NorthstarDemo1!')
    await run('bash', [fileURLToPath(new URL('./scenarios/lifecycle-smoke.sh', import.meta.url))], {
      env: { ...process.env, BASE_URL: app.base, DB_PATH: app.dbPath, DEMO_PASSWORD: 'NorthstarDemo1!' },
      timeout: 200000, maxBuffer: 1024 * 1024 })
  }, { OPS_AGENT_API_KEY: 'security-lifecycle-agent-key' }))
