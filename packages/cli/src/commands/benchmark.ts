import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export interface BenchmarkOptions {
  args?: string[]
}

export async function benchmarkCommand(options: BenchmarkOptions = {}): Promise<void> {
  const benchmarkCliPath = resolve(process.cwd(), 'benchmark/cli.mjs')
  const args = options.args ?? []

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [benchmarkCliPath, ...args], {
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`Benchmark command exited with code ${code ?? 1}`))
      }
    })

    child.on('error', reject)
  })
}
