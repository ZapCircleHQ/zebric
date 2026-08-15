import { resolve } from 'node:path'
import { createZebricAgent, type CreateZebricAgentOptions, type ZebricAgent } from '../agent/create-zebric-agent.js'
import { resolveExistingWorkspacePath } from '../authoring/workspace-path.js'
import { validateBlueprint, type BlueprintValidationResult } from '../authoring/validate-blueprint.js'
import { ZebricApiError } from '../runtime/action-tool-factory.js'

export const ZebricAgentExitCode = {
  success: 0,
  internal: 1,
  configuration: 2,
  validation: 3,
  approvalRejected: 4,
  authentication: 5,
  conflict: 6,
  incomplete: 7,
} as const

export interface ZebricAgentCliIo {
  stdout(value: string): void
  stderr(value: string): void
  cwd(): string
  env: Record<string, string | undefined>
}

export interface ZebricAgentCliDependencies {
  createAgent(options: CreateZebricAgentOptions): Promise<ZebricAgent>
  validate(path: string): Promise<BlueprintValidationResult>
}

const defaultIo: ZebricAgentCliIo = {
  stdout: value => process.stdout.write(`${value}\n`),
  stderr: value => process.stderr.write(`${value}\n`),
  cwd: () => process.cwd(),
  env: process.env,
}

const defaultDependencies: ZebricAgentCliDependencies = {
  createAgent: createZebricAgent,
  validate: path => validateBlueprint({ path }),
}

export async function runZebricAgentCli(
  argv: string[],
  io: ZebricAgentCliIo = defaultIo,
  dependencies: ZebricAgentCliDependencies = defaultDependencies
): Promise<number> {
  let parsed: ParsedArguments
  try {
    parsed = parseArguments(argv)
  } catch (error) {
    return writeError(io, argv.includes('--json'), ZebricAgentExitCode.configuration, 'CONFIGURATION_ERROR', safeMessage(error))
  }

  try {
    if (parsed.command === 'validate') {
      const workspace = resolve(parsed.workspace ?? io.cwd())
      const blueprintPath = await resolveExistingWorkspacePath(workspace, parsed.blueprint)
      const result = await dependencies.validate(blueprintPath)
      if (!result.valid) {
        writeResult(io, parsed.json, { ok: false, command: 'validate', result })
        return ZebricAgentExitCode.validation
      }
      writeResult(io, parsed.json, {
        ok: true,
        command: 'validate',
        result: { valid: true, path: result.path, project: result.blueprint.project },
      })
      return ZebricAgentExitCode.success
    }

    const secretValues: string[] = []
    const applications: NonNullable<CreateZebricAgentOptions['applications']> = []
    if (parsed.connect) {
      if (parsed.credentialEnv) {
        const value = io.env[parsed.credentialEnv]
        if (value) secretValues.push(value)
      }
      applications.push({
        name: 'connected',
        baseUrl: parsed.connect,
        ...(parsed.credentialEnv ? { credential: { type: 'env' as const, name: parsed.credentialEnv } } : {}),
      })
    }
    const agent = await dependencies.createAgent({
      model: parsed.model,
      workspace: { root: resolve(parsed.workspace ?? io.cwd()), mode: 'read-only' },
      applications,
    })
    const result = await agent.invoke({ messages: [{ role: 'user', content: parsed.prompt }] })
    writeResult(io, parsed.json, redactValue({ ok: true, command: 'run', result }, secretValues))
    return ZebricAgentExitCode.success
  } catch (error) {
    const classified = classifyError(error)
    const secrets = parsed.command === 'run' && parsed.credentialEnv && io.env[parsed.credentialEnv]
      ? [io.env[parsed.credentialEnv]!]
      : []
    return writeError(io, parsed.json, classified.exitCode, classified.code, redactText(classified.message, secrets))
  }
}

type ParsedArguments =
  | { command: 'validate'; blueprint: string; workspace?: string; json: boolean }
  | { command: 'run'; prompt: string; model: string; connect?: string; credentialEnv?: string; workspace?: string; json: boolean }

function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...args] = argv
  if (command !== 'validate' && command !== 'run') throw new TypeError('Usage: zebric-agent <validate|run> [options]')
  const options = new Map<string, string | true>()
  const positional: string[] = []
  const valueOptions = new Set(['--workspace', '--prompt', '--model', '--connect', '--credential-env'])
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    if (argument === '--json') {
      options.set(argument, true)
      continue
    }
    if (!valueOptions.has(argument)) throw new TypeError(`Unknown option: ${argument}`)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new TypeError(`Option requires a value: ${argument}`)
    options.set(argument, value)
  }
  const workspace = optionString(options, '--workspace')
  const json = options.has('--json')
  if (command === 'validate') {
    if (positional.length > 1) throw new TypeError('validate accepts at most one Blueprint path')
    return { command, blueprint: positional[0] ?? 'blueprint.toml', ...(workspace ? { workspace } : {}), json }
  }
  if (positional.length) throw new TypeError('run does not accept positional arguments')
  const prompt = optionString(options, '--prompt')
  const model = optionString(options, '--model')
  if (!prompt) throw new TypeError('run requires --prompt')
  if (!model) throw new TypeError('run requires --model')
  const connect = optionString(options, '--connect')
  const credentialEnv = optionString(options, '--credential-env')
  if (credentialEnv && !connect) throw new TypeError('--credential-env requires --connect')
  return {
    command, prompt, model,
    ...(connect ? { connect } : {}),
    ...(credentialEnv ? { credentialEnv } : {}),
    ...(workspace ? { workspace } : {}),
    json,
  }
}

function optionString(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name)
  return typeof value === 'string' ? value : undefined
}

function classifyError(error: unknown): { exitCode: number; code: string; message: string } {
  if (error instanceof ZebricApiError) {
    if (error.kind === 'authentication' || error.kind === 'authorization') {
      return { exitCode: ZebricAgentExitCode.authentication, code: error.code, message: error.message }
    }
    if (error.kind === 'conflict') return { exitCode: ZebricAgentExitCode.conflict, code: error.code, message: error.message }
  }
  const message = safeMessage(error)
  if (message.includes('not approved')) return { exitCode: ZebricAgentExitCode.approvalRejected, code: 'APPROVAL_REJECTED', message }
  if (message.includes('Timed out waiting')) return { exitCode: ZebricAgentExitCode.incomplete, code: 'INCOMPLETE_EXECUTION', message }
  if (error instanceof TypeError) return { exitCode: ZebricAgentExitCode.configuration, code: 'CONFIGURATION_ERROR', message }
  return { exitCode: ZebricAgentExitCode.internal, code: 'INTERNAL_ERROR', message }
}

function writeError(io: ZebricAgentCliIo, json: boolean, exitCode: number, code: string, message: string): number {
  const output = { ok: false, error: { code, message } }
  if (json) io.stdout(JSON.stringify(output))
  else io.stderr(`${code}: ${message}`)
  return exitCode
}

function writeResult(io: ZebricAgentCliIo, json: boolean, value: unknown): void {
  io.stdout(json ? JSON.stringify(value) : humanOutput(value))
}

function humanOutput(value: unknown): string {
  if (value && typeof value === 'object' && 'command' in value) {
    const output = value as { command: unknown; ok?: unknown; result?: unknown }
    if (output.command === 'validate') {
      return output.ok === true ? 'Blueprint is valid.' : `Blueprint validation failed.\n${JSON.stringify(output.result, null, 2)}`
    }
    return JSON.stringify(output.result, null, 2)
  }
  return JSON.stringify(value, null, 2)
}

function redactValue(value: unknown, secrets: string[]): unknown {
  return JSON.parse(redactText(JSON.stringify(value), secrets))
}

function redactText(value: string, secrets: string[]): string {
  return secrets.filter(Boolean).reduce((output, secret) => output.split(secret).join('[REDACTED]'), value)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
