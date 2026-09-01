#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createZebricMcpServer } from './server.js'

interface CliOptions {
  connect: string
  applicationName?: string
  credentialEnv?: string
  allowedMutations: string[]
}

function parseArgs(args: string[]): CliOptions {
  let connect: string | undefined
  let applicationName: string | undefined
  let credentialEnv: string | undefined
  const allowedMutations: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${flag}`)
    if (flag === '--connect') connect = value
    else if (flag === '--application-name') applicationName = value
    else if (flag === '--credential-env') credentialEnv = value
    else if (flag === '--allow-mutation') allowedMutations.push(value)
    else throw new TypeError(`Unknown option: ${flag}`)
    index += 1
  }
  if (!connect) throw new TypeError('Usage: zebric-mcp-server --connect <url> [--credential-env <name>] [--allow-mutation <operationId>]')
  return { connect, applicationName, credentialEnv, allowedMutations }
}

export async function runZebricMcpServerCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  if (options.credentialEnv && !process.env[options.credentialEnv]) {
    throw new Error(`Credential environment variable is not set: ${options.credentialEnv}`)
  }
  const server = await createZebricMcpServer({
    applicationUrl: options.connect,
    applicationName: options.applicationName,
    credential: options.credentialEnv ? () => process.env[options.credentialEnv!] : undefined,
    allowedMutations: options.allowedMutations,
  })
  await server.connect(new StdioServerTransport())
}

runZebricMcpServerCli().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
