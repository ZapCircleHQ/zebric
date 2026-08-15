import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZebricApiError } from '../runtime/action-tool-factory.js'
import { runZebricAgentCli, ZebricAgentExitCode, type ZebricAgentCliDependencies } from './main.js'

describe('runZebricAgentCli', () => {
  let workspace = ''
  let stdout: string[]
  let stderr: string[]

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'zebric-agent-cli-'))
    await writeFile(join(workspace, 'blueprint.toml'), '[project]\nname = "CLI Test"\n')
    stdout = []
    stderr = []
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('returns structured validation output and the validation exit code', async () => {
    const dependencies = dependenciesWith({
      validate: async path => ({
        valid: false, path,
        errors: [{ path: ['entities'], code: 'invalid', message: 'Invalid entity' } as any],
      }),
    })
    const exitCode = await runZebricAgentCli([
      'validate', 'blueprint.toml', '--workspace', workspace, '--json',
    ], io(), dependencies)

    expect(exitCode).toBe(ZebricAgentExitCode.validation)
    expect(JSON.parse(stdout[0]!)).toMatchObject({
      ok: false, command: 'validate', result: { valid: false },
    })
    expect(stderr).toEqual([])
  })

  it('runs a read-only prompt and redacts configured credentials from JSON output', async () => {
    const secret = 'cli-secret-value'
    let receivedOptions: any
    const dependencies = dependenciesWith({
      createAgent: async options => {
        receivedOptions = options
        return {
          invoke: async () => ({ messages: [{ role: 'assistant', content: `echo ${secret}` }] }),
          resume: async () => ({}),
        }
      },
    })
    const exitCode = await runZebricAgentCli([
      'run', '--prompt', 'List ready work', '--model', 'provider:model',
      '--connect', 'https://app.example', '--credential-env', 'ZEBRIC_CLI_TOKEN',
      '--workspace', workspace, '--json',
    ], io({ ZEBRIC_CLI_TOKEN: secret }), dependencies)

    expect(exitCode).toBe(ZebricAgentExitCode.success)
    expect(receivedOptions).toMatchObject({
      model: 'provider:model',
      workspace: { root: workspace, mode: 'read-only' },
      applications: [{
        name: 'connected', baseUrl: 'https://app.example',
        credential: { type: 'env', name: 'ZEBRIC_CLI_TOKEN' },
      }],
    })
    expect(stdout[0]).toContain('[REDACTED]')
    expect(stdout[0]).not.toContain(secret)
  })

  it('returns stable configuration and authentication errors', async () => {
    const missingPrompt = await runZebricAgentCli(['run', '--model', 'provider:model', '--json'], io(), dependenciesWith())
    expect(missingPrompt).toBe(ZebricAgentExitCode.configuration)
    expect(JSON.parse(stdout.pop()!)).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })

    const authentication = await runZebricAgentCli([
      'run', '--prompt', 'Read', '--model', 'provider:model', '--json',
    ], io(), dependenciesWith({
      createAgent: async () => ({
        invoke: async () => { throw new ZebricApiError('Unauthorized', 401, 'UNAUTHORIZED', 'req-1', 'authentication', false) },
        resume: async () => ({}),
      }),
    }))
    expect(authentication).toBe(ZebricAgentExitCode.authentication)
    expect(JSON.parse(stdout.pop()!)).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })

  it.each([
    ['approval rejection', new Error('Zebric mutation was not approved'), ZebricAgentExitCode.approvalRejected, 'APPROVAL_REJECTED'],
    ['conflict', new ZebricApiError('Conflict', 409, 'STATE_CONFLICT', 'req-2', 'conflict', false), ZebricAgentExitCode.conflict, 'STATE_CONFLICT'],
    ['incomplete execution', new Error('Timed out waiting for Zebric workflow job'), ZebricAgentExitCode.incomplete, 'INCOMPLETE_EXECUTION'],
    ['internal failure', new Error('Unexpected failure'), ZebricAgentExitCode.internal, 'INTERNAL_ERROR'],
  ])('returns a stable exit code for %s', async (_label, failure, expectedExit, expectedCode) => {
    const exitCode = await runZebricAgentCli([
      'run', '--prompt', 'Act', '--model', 'provider:model', '--json',
    ], io(), dependenciesWith({
      createAgent: async () => ({
        invoke: async () => { throw failure },
        resume: async () => ({}),
      }),
    }))

    expect(exitCode).toBe(expectedExit)
    expect(JSON.parse(stdout.pop()!)).toMatchObject({ error: { code: expectedCode } })
  })

  function io(env: Record<string, string | undefined> = {}) {
    return {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      cwd: () => workspace,
      env,
    }
  }
})

function dependenciesWith(overrides: Partial<ZebricAgentCliDependencies> = {}): ZebricAgentCliDependencies {
  return {
    createAgent: vi.fn(async () => ({ invoke: async () => ({}), resume: async () => ({}) })),
    validate: vi.fn(async path => ({ valid: true, path, blueprint: { project: { name: 'Test' } } as any })),
    ...overrides,
  }
}
