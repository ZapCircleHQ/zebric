import { AIMessage, type AIMessageChunk, type BaseMessage, type ToolCall } from '@langchain/core/messages'
import { BaseChatModel, type BaseChatModelCallOptions, type BindToolsInput } from '@langchain/core/language_models/chat_models'
import type { ChatResult } from '@langchain/core/outputs'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base'

export interface ScriptedModelRequest {
  messages: Array<{ type: string; content: unknown; name?: string; toolCallId?: string }>
  tools: Array<{ name: string; description?: string }>
}

export interface ScriptedModelResponse {
  content?: string
  toolCalls?: ToolCall[]
}

/** HTTP-backed deterministic chat model for black-box CLI and integration tests. */
export class ScriptedHttpModel extends BaseChatModel<BaseChatModelCallOptions> {
  private readonly endpoint: string
  private readonly tools: BindToolsInput[]

  constructor(endpoint: string, tools: BindToolsInput[] = []) {
    super({})
    this.endpoint = endpoint
    this.tools = tools
  }

  _llmType(): string {
    return 'zebric-scripted-http'
  }

  bindTools(tools: BindToolsInput[]): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return new ScriptedHttpModel(this.endpoint, [...this.tools, ...tools]).withConfig({})
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const request: ScriptedModelRequest = {
      messages: messages.map(message => ({
        type: message.getType(),
        content: message.content,
        ...(typeof message.name === 'string' ? { name: message.name } : {}),
        ...('tool_call_id' in message && typeof message.tool_call_id === 'string'
          ? { toolCallId: message.tool_call_id }
          : {}),
      })),
      tools: this.tools.map(tool => ({
        name: toolName(tool),
        ...(toolDescription(tool) ? { description: toolDescription(tool) } : {}),
      })),
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      throw new Error(`Scripted model rejected turn (${response.status}): ${await response.text()}`)
    }
    const scripted = await response.json() as ScriptedModelResponse
    if (typeof scripted.content !== 'string' && !scripted.toolCalls?.length) {
      throw new Error('Scripted model response must contain content or toolCalls')
    }
    return {
      generations: [{
        text: scripted.content ?? '',
        message: new AIMessage({
          content: scripted.content ?? '',
          ...(scripted.toolCalls ? { tool_calls: scripted.toolCalls } : {}),
        }),
      }],
    }
  }
}

export function scriptedModelFromIdentifier(identifier: string): ScriptedHttpModel | undefined {
  const prefix = identifier.startsWith('scripted+http://')
    ? 'scripted+'
    : identifier.startsWith('scripted+https://') ? 'scripted+' : undefined
  if (!prefix) return undefined
  const endpoint = new URL(identifier.slice(prefix.length))
  if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new TypeError('Scripted model endpoints must use the local loopback interface')
  }
  return new ScriptedHttpModel(endpoint.href)
}

function toolName(tool: BindToolsInput): string {
  if (tool && typeof tool === 'object' && 'name' in tool && typeof tool.name === 'string') return tool.name
  return 'unknown'
}

function toolDescription(tool: BindToolsInput): string | undefined {
  if (tool && typeof tool === 'object' && 'description' in tool && typeof tool.description === 'string') return tool.description
  return undefined
}
