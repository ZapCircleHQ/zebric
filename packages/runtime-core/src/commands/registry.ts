import type { Command } from '../types/blueprint.js'
import { ValidationFailureError } from '../errors/domain-errors.js'

export class CommandRegistry {
  private readonly commands = new Map<string, Command>()

  constructor(commands: Command[] = []) {
    for (const command of commands) this.register(command)
  }

  register(command: Command): void {
    if (this.commands.has(command.name)) {
      throw new ValidationFailureError(`Duplicate command definition: ${command.name}`, {
        command: command.name,
      })
    }
    this.commands.set(command.name, command)
  }

  get(name: string): Command | undefined {
    return this.commands.get(name)
  }

  list(): Command[] {
    return [...this.commands.values()]
  }
}
