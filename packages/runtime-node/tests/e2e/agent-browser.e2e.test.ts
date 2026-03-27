import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createZebric, type Zebric } from '../../src/programmatic.js'

const runSuite = process.env.RUN_AGENT_BROWSER_E2E === '1' ? describe : describe.skip

type Scenario = {
  name: string
  instruction: string
  timeoutMs?: number
}

type CommandResult = {
  code: number | null
  stdout: string
  stderr: string
}

runSuite('agent-browser E2E rendering checks', () => {
  let tmpRoot = ''
  let blueprintPath = ''
  let dbPath = ''
  let zebric: Zebric | undefined
  let baseUrl = ''

  beforeAll(async () => {
    requireAgentBrowserEnv()

    tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-agent-browser-'))
    dbPath = join(tmpRoot, 'app.db')
    blueprintPath = join(tmpRoot, 'blueprint.toml')

    const starterBlueprint = resolve(process.cwd(), '../../starters/cloudflare-workers/blueprint.toml')
    await writeFile(blueprintPath, await readFile(starterBlueprint, 'utf8'), 'utf8')

    const port = Number(process.env.ZEBRIC_AGENT_BROWSER_PORT ?? '4317')
    baseUrl = `http://127.0.0.1:${port}`

    zebric = await createZebric({
      blueprintPath,
      host: '127.0.0.1',
      port,
      databaseUrl: `sqlite://${dbPath}`,
      validateBeforeStart: false,
    })

    await waitForHttp(`${baseUrl}/health`, 15_000)
  }, 45_000)

  afterAll(async () => {
    if (zebric) {
      await zebric.stop()
    }
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  })

  const scenarios: Scenario[] = [
    {
      name: 'renders task list page with core UI chrome',
      instruction: `
Open ${'${BASE_URL}'}/tasks.
Verify the page renders as HTML (not a JSON blob) and visually shows the task list UI.
Confirm there is navigation visible and the page title/header references tasks.
If all checks pass, print exactly: VERDICT:PASS
If any check fails, print exactly: VERDICT:FAIL and briefly explain why.
`.trim(),
    },
    {
      name: 'renders new task form and expected inputs',
      instruction: `
Open ${'${BASE_URL}'}/tasks/new.
Verify a form is visible for creating a task.
Confirm inputs/controls for title, description, status, and priority are present.
Do not submit yet.
If all checks pass, print exactly: VERDICT:PASS
If any check fails, print exactly: VERDICT:FAIL and briefly explain why.
`.trim(),
    },
    {
      name: 'can create a task through the UI and see it after submit',
      timeoutMs: 120_000,
      instruction: `
Open ${'${BASE_URL}'}/tasks/new.
Fill the form with:
- title: Agent Browser Created Task
- description: Created by agent-browser E2E test
- status: pending
- priority: 5
Submit the form using the primary submit action.
Verify the app navigates successfully and the text "Agent Browser Created Task" is visible afterward (either in list or detail view).
If all checks pass, print exactly: VERDICT:PASS
If any check fails, print exactly: VERDICT:FAIL and briefly explain why.
`.trim(),
    },
  ]

  for (const scenario of scenarios) {
    it(
      scenario.name,
      async () => {
        const prompt = scenario.instruction.replaceAll('${BASE_URL}', baseUrl)
        const result = await runAgentBrowser(prompt, scenario.timeoutMs ?? 90_000)

        const combined = `${result.stdout}\n${result.stderr}`.trim()
        expect(result.code, combined).toBe(0)
        expect(combined, combined).toContain('VERDICT:PASS')
        expect(combined, combined).not.toContain('VERDICT:FAIL')
      },
      scenario.timeoutMs ?? 90_000
    )
  }
})

function requireAgentBrowserEnv(): void {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY)
  if (!hasApiKey) {
    throw new Error('OPENAI_API_KEY is required for agent-browser E2E tests')
  }
}

function getCommandTemplate(): string {
  return process.env.AGENT_BROWSER_CMD_TEMPLATE ?? 'agent-browser "{PROMPT}"'
}

async function runAgentBrowser(prompt: string, timeoutMs: number): Promise<CommandResult> {
  const template = getCommandTemplate()
  const command = template.replaceAll('{PROMPT}', shellEscape(prompt))

  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn('zsh', ['-lc', command], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`agent-browser timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet.
    }
    await sleep(250)
  }

  throw new Error(`Timed out waiting for server: ${url}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
