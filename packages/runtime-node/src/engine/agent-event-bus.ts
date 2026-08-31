import { randomUUID } from 'node:crypto'

export interface AgentEvent {
  id: string
  type: string
  occurredAt: string
  subject?: string
  data: Record<string, unknown>
  audienceId?: string
}

export type AgentEventInput = Omit<AgentEvent, 'id' | 'occurredAt'> & {
  id?: string
  occurredAt?: string
}

export class AgentEventBus {
  private readonly listeners = new Set<(event: AgentEvent) => void>()

  publish(input: AgentEventInput): AgentEvent {
    const event: AgentEvent = {
      id: input.id ?? randomUUID(),
      type: input.type,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      data: input.data,
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.audienceId ? { audienceId: input.audienceId } : {}),
    }
    for (const listener of this.listeners) listener(event)
    return event
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
