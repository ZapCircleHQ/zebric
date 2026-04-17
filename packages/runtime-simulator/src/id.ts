let counter = 0

export function createSimulatorId(prefix = 'sim'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function createRecordId(): string {
  return createSimulatorId('rec')
}
