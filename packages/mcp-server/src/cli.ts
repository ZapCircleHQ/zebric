#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFile } from 'node:fs/promises'
import { startZebricMcpHttpServer } from './node.js'
import { createZebricMcpServer } from './server.js'

interface CliOptions {
  connect: string
  applicationName?: string
  credentialEnv?: string
  allowedMutations: string[]
  transport: 'stdio' | 'http'
  host?: string
  port?: number
  tlsCert?: string
  tlsKey?: string
  authEnv?: string
  allowedOrigins: string[]
  allowUnauthenticated: boolean
}

function parseArgs(args: string[]): CliOptions {
  let connect: string | undefined
  let applicationName: string | undefined
  let credentialEnv: string | undefined
  const allowedMutations: string[] = []
  let transport: 'stdio' | 'http' = 'stdio'
  let host: string | undefined
  let port: number | undefined
  let tlsCert: string | undefined
  let tlsKey: string | undefined
  let authEnv: string | undefined
  const allowedOrigins: string[] = []
  let allowUnauthenticated = false
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--allow-unauthenticated') {
      allowUnauthenticated = true
      continue
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new TypeError(`Missing value for ${flag}`)
    if (flag === '--connect') connect = value
    else if (flag === '--application-name') applicationName = value
    else if (flag === '--credential-env') credentialEnv = value
    else if (flag === '--allow-mutation') allowedMutations.push(value)
    else if (flag === '--transport') {
      if (value !== 'stdio' && value !== 'http') throw new TypeError('Transport must be stdio or http')
      transport = value
    }
    else if (flag === '--host') host = value
    else if (flag === '--port') {
      port = Number(value)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Port must be an integer between 0 and 65535')
    }
    else if (flag === '--tls-cert') tlsCert = value
    else if (flag === '--tls-key') tlsKey = value
    else if (flag === '--auth-env') authEnv = value
    else if (flag === '--allowed-origin') allowedOrigins.push(value)
    else throw new TypeError(`Unknown option: ${flag}`)
    index += 1
  }
  if (!connect) throw new TypeError('Usage: zebric-mcp-server --connect <url> [--transport stdio|http] [--host <host>] [--port <port>] [--tls-cert <pem> --tls-key <pem>] [--auth-env <name>] [--credential-env <name>] [--allow-mutation <operationId>]')
  if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new TypeError('--tls-cert and --tls-key must be supplied together')
  if (transport === 'stdio' && (host || port !== undefined || tlsCert || authEnv || allowedOrigins.length || allowUnauthenticated)) {
    throw new TypeError('HTTP options require --transport http')
  }
  return { connect, applicationName, credentialEnv, allowedMutations, transport, host, port, tlsCert, tlsKey, authEnv, allowedOrigins, allowUnauthenticated }
}

export async function runZebricMcpServerCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args)
  if (options.credentialEnv && !process.env[options.credentialEnv]) {
    throw new Error(`Credential environment variable is not set: ${options.credentialEnv}`)
  }
  if (options.authEnv && !process.env[options.authEnv]) {
    throw new Error(`Authentication environment variable is not set: ${options.authEnv}`)
  }
  const serverOptions = {
    applicationUrl: options.connect,
    applicationName: options.applicationName,
    credential: options.credentialEnv ? () => process.env[options.credentialEnv!] : undefined,
    allowedMutations: options.allowedMutations,
  }
  if (options.transport === 'http') {
    const server = await startZebricMcpHttpServer({
      ...serverOptions,
      host: options.host,
      port: options.port,
      allowUnauthenticated: options.allowUnauthenticated ? true : undefined,
      allowedOrigins: options.allowedOrigins,
      authorize: options.authEnv ? request => Boolean(process.env[options.authEnv!]) && request.headers.get('authorization') === `Bearer ${process.env[options.authEnv!]}` : undefined,
      tls: options.tlsCert ? { cert: await readFile(options.tlsCert), key: await readFile(options.tlsKey!) } : undefined,
    })
    const address = server.address()
    console.error(`Zebric MCP listening on ${options.tlsCert ? 'https' : 'http'}://${options.host ?? '127.0.0.1'}:${address && typeof address !== 'string' ? address.port : options.port}/mcp`)
    return
  }
  const server = await createZebricMcpServer(serverOptions)
  await server.connect(new StdioServerTransport())
}

runZebricMcpServerCli().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
