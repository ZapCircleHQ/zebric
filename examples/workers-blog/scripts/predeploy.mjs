// Fails before a remote migration or deploy when wrangler.toml still has the
// placeholder database ID or no production auth origin.
import { readFileSync } from 'node:fs'

const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const active = config.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')
const problems = []

if (/database_id\s*=\s*"0{8}-0{4}-0{4}-0{4}-0{12}"/.test(active)) {
  problems.push('wrangler.toml still has the placeholder D1 database_id. Run `pnpm db:create` and paste the returned ID.')
}
const origin = active.match(/^\s*BETTER_AUTH_URL\s*=\s*"([^"]*)"/m)?.[1]
if (!origin) {
  problems.push('wrangler.toml has no [vars] BETTER_AUTH_URL. Uncomment [vars] and set your public HTTPS origin.')
} else if (!origin.startsWith('https://')) {
  problems.push(`BETTER_AUTH_URL must be an https:// origin for a deployed Worker (found "${origin}").`)
}

if (problems.length) {
  console.error('Not ready to deploy:\n' + problems.map(problem => `  - ${problem}`).join('\n'))
  console.error('\nAlso set the secret once: pnpm exec wrangler secret put BETTER_AUTH_SECRET')
  process.exit(1)
}
