import { createSimulatorId } from './id.js'
import type { SimulatorLogEntry } from './types.js'

export class SimulatorLogger {
  private entries: SimulatorLogEntry[] = []

  log(entry: Omit<SimulatorLogEntry, 'id' | 'timestamp'>): SimulatorLogEntry {
    const fullEntry: SimulatorLogEntry = {
      id: createSimulatorId('log'),
      timestamp: Date.now(),
      ...entry,
    }
    this.entries = [fullEntry, ...this.entries].slice(0, 200)
    return fullEntry
  }

  getEntries(): SimulatorLogEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }
}
