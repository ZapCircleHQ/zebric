import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBenchmark } from './runner/benchmarkRunner.mjs'
import { analyzeReports } from './runner/reportAnalyzer.mjs'
import { seedBenchmark } from './seed/seedRunner.mjs'
import { startNotificationSink } from './simulators/notification-sink.mjs'
import { startWebhookSimulator } from './simulators/webhook-simulator.mjs'
import { runWorker } from './runner/workerRunner.mjs'

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { _: [] }
  for (const arg of rest) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      options[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value ?? true
    } else {
      options._.push(arg)
    }
  }
  return { command, options }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))

  switch (command) {
    case 'seed':
      await seedBenchmark(options)
      break
    case 'run':
      await runBenchmark(options)
      break
    case 'report': {
      const input = options.input ? resolve(process.cwd(), options.input) : resolve('benchmark/results/latest.json')
      const report = JSON.parse(readFileSync(input, 'utf8'))
      console.log(JSON.stringify(report, null, 2))
      break
    }
    case 'analyze':
      analyzeReports(options.input ?? 'benchmark/results')
      break
    case 'notification-sink':
      await startNotificationSink(options)
      console.log(`notification-sink listening on ${options.host ?? '127.0.0.1'}:${options.port ?? 3210}`)
      break
    case 'webhook-simulator':
      await startWebhookSimulator(options)
      console.log(`webhook-simulator listening on ${options.host ?? '0.0.0.0'}:${options.port ?? 3220}`)
      break
    case 'worker':
      await runWorker(options)
      break
    default:
      console.log('Usage: node benchmark/cli.mjs <seed|run|report|analyze|notification-sink|webhook-simulator|worker> [--key=value]')
      process.exit(command ? 1 : 0)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
