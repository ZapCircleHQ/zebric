export interface DeterministicTool {
  name: string
  invoke(input: Record<string, unknown>): Promise<unknown>
}

export interface DeterministicToolCall {
  tool: string
  input: Record<string, unknown>
}

export interface DeterministicToolResult extends DeterministicToolCall {
  output: unknown
}

/**
 * Executes an explicit tool-call script without a model. This exercises the
 * same generated LangChain tools used by Zebric Agent while keeping E2E tests
 * repeatable and free of provider credentials.
 */
export class DeterministicAgentDriver {
  private readonly tools: Map<string, DeterministicTool>
  readonly transcript: DeterministicToolResult[] = []

  constructor(tools: DeterministicTool[]) {
    this.tools = new Map(tools.map(tool => [tool.name, tool]))
    if (this.tools.size !== tools.length) {
      throw new Error('Deterministic agent tools must have unique names')
    }
  }

  async invoke(call: DeterministicToolCall): Promise<unknown> {
    const selected = this.tools.get(call.tool)
    if (!selected) throw new Error(`Unknown deterministic agent tool: ${call.tool}`)
    const output = await selected.invoke(call.input)
    this.transcript.push({ ...call, output })
    return output
  }
}
