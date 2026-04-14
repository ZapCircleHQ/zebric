import type { SimulatorAccount, SimulatorSeeds } from './types.js'

export const defaultSimulatorAccounts: SimulatorAccount[] = [
  {
    id: 'user',
    email: 'user@example.test',
    name: 'User',
    role: 'user',
    roles: ['user'],
  },
  {
    id: 'manager',
    email: 'manager@example.test',
    name: 'Manager',
    role: 'manager',
    roles: ['manager'],
  },
]

export const defaultSimulatorSeeds: SimulatorSeeds = {
  empty: {},
}
