import type { ApiSimulationPolicy } from './types.js'
import type { SimulatorLogger } from './logger.js'

export interface SimulatedApiCall {
  method: string
  url: string
  body?: unknown
  headers?: Record<string, string>
}

export class SimulatorApiClient {
  constructor(
    private policy: ApiSimulationPolicy,
    private logger: SimulatorLogger
  ) {}

  async request(call: SimulatedApiCall): Promise<Response> {
    this.logger.log({
      type: 'api',
      message: `${call.method.toUpperCase()} ${call.url}`,
      detail: { policy: this.policy.mode, call },
    })

    if (this.policy.mode === 'mock') {
      const mock = this.policy.mocks?.find((candidate) => {
        if (typeof candidate.match === 'string') {
          return call.url.includes(candidate.match)
        }
        return candidate.match.test(call.url)
      })

      if (mock) {
        return Response.json(mock.response, { status: mock.status ?? 200 })
      }
    }

    return Response.json({
      simulated: true,
      mode: this.policy.mode,
      url: call.url,
      method: call.method,
    })
  }
}
