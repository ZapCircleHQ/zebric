import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer } from 'node:net'
import { InvalidArgumentError } from 'commander'

export function parsePort(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) > 65535) {
    throw new InvalidArgumentError('Use a whole-number port from 0 to 65535 (0 selects a free port).')
  }
  return Number(value)
}

export function getDevPorts(port = 3000, adminPort?: number): { port: number; adminPort: number } {
  for (const value of [port, adminPort]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 65535)) {
      throw new Error('Use a whole-number port from 0 to 65535 (0 selects a free port).')
    }
  }
  const admin = adminPort ?? (port === 0 ? 0 : port + 30)
  if (admin > 65535) throw new Error('The default admin port (app port + 30) exceeds 65535. Set --admin-port <number>, or use --admin-port 0 for a free port.')
  if (port !== 0 && port === admin) throw new Error('App and admin ports must differ. Choose another --admin-port, or use --admin-port 0.')
  return { port, adminPort: admin }
}

/** Fail before opening the database when the configured development ports are in use. */
export async function checkDevPort(host: string, port: number, label: 'App' | 'Admin'): Promise<void> {
  const probe = createServer()
  try {
    await new Promise<void>((resolveListen, reject) => {
      probe.once('error', reject)
      probe.listen(port, host, () => resolveListen())
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') {
      throw new Error(`${label} port ${port} on ${host} is already in use. Stop the other process or choose ${label === 'App' ? '--port' : '--admin-port'} <number>.`)
    }
    throw error
  } finally {
    if (probe.listening) await new Promise<void>((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()))
  }
}

export async function checkBlueprintReadable(path: string): Promise<void> {
  try { await access(path, constants.R_OK) } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`Blueprint file not found at ${path}. Use --blueprint <path> to select an existing TOML or JSON file.`)
    throw new Error(`Cannot read Blueprint at ${path}. Check the file permissions.`)
  }
  if (!(await stat(path)).isFile()) throw new Error(`Blueprint path ${path} must point to a file. Use --blueprint <path> to select a TOML or JSON file.`)
}

export function startupErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_READONLY' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'EEXIST') {
    return `${message}\nCheck that data/ is a writable directory and data/app.db can be opened for writing.`
  }
  if (code === 'EADDRINUSE') return `${message}\nChoose another --port or --admin-port, or stop the process using that port.`
  return message
}
