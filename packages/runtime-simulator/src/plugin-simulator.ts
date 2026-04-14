import type { PluginSimulationPolicy, SimulatorPluginLevel } from './types.js'
import type { SimulatorLogger } from './logger.js'

export class SimulatorPluginHost {
  constructor(
    private policy: PluginSimulationPolicy,
    private logger: SimulatorLogger
  ) {}

  invoke(pluginName: string, capability: string, payload?: unknown): unknown {
    const level = this.getLevel(pluginName)
    const detail = { pluginName, capability, level, payload }

    this.logger.log({
      type: 'plugin',
      message: `Plugin ${pluginName}.${capability} simulated at level ${level}`,
      detail,
    })

    if (level >= 1 && typeof console !== 'undefined') {
      console.debug('[Zebric Simulator plugin]', detail)
    }

    return {
      simulated: true,
      level,
      pluginName,
      capability,
    }
  }

  getLevel(pluginName: string): SimulatorPluginLevel {
    return this.policy.perPlugin?.[pluginName] ?? this.policy.defaultLevel
  }
}
