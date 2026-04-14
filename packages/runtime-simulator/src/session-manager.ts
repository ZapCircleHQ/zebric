import type { HttpRequest, SessionManagerPort } from '@zebric/runtime-core'
import type { SimulatorAccount, SimulatorSession } from './types.js'

export class SimulatorSessionManager implements SessionManagerPort {
  private activeAccount: SimulatorAccount | null

  constructor(activeAccount: SimulatorAccount | null) {
    this.activeAccount = activeAccount
  }

  setActiveAccount(account: SimulatorAccount | null): void {
    this.activeAccount = account
  }

  async getSession(_request: HttpRequest): Promise<SimulatorSession | null> {
    if (!this.activeAccount) {
      return null
    }

    return {
      id: `sim-session-${this.activeAccount.id}`,
      userId: this.activeAccount.id,
      user: {
        ...this.activeAccount,
        id: this.activeAccount.id,
        email: this.activeAccount.email,
        name: this.activeAccount.name,
        role: this.activeAccount.role,
      },
      createdAt: new Date(0),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
  }
}
