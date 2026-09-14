import Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ModelRuntimeStatus } from '@shared/models'
import type {
  CompleteRequest,
  ModelProvider,
  PlanRequest,
  StopReason,
  TurnRequest,
  TurnResult
} from './types'

/** The Claude models the agent can run, newest and most capable first. */
export const ANTHROPIC_MODELS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' }
]

/**
 * Claude, through the Anthropic SDK: the reference provider.
 *
 * This is the code that ran the agent before there was a seam, moved and not
 * changed: adaptive thinking by default on these models, the server-side
 * fallbacks that route a policy decline to another model, streaming with the
 * SDK's own final-message helper. Every other provider is measured against it.
 */
export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const

  constructor(private readonly resolveKey: () => string | null) {}

  private client(): Anthropic {
    const apiKey = this.resolveKey()
    if (!apiKey) throw new Error('No API key configured. Add one in Settings → AI.')
    return new Anthropic({ apiKey })
  }

  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS.map((m) => ({
      id: `anthropic/${m.id}`,
      provider: 'anthropic',
      model: m.id,
      label: m.label,
      local: false,
      capabilities: { tools: true, thinking: true, vision: true },
      contextLength: m.id.startsWith('claude-haiku') ? 200_000 : 1_000_000
    }))
  }

  async status(): Promise<ModelRuntimeStatus> {
    const configured = Boolean(this.resolveKey())
    return {
      provider: 'anthropic',
      id: 'anthropic',
      label: 'Claude',
      installed: true,
      running: configured,
      endpoint: 'https://api.anthropic.com',
      detail: configured ? 'API key configured' : 'No API key — add one in Settings → AI'
    }
  }

  async plan(request: PlanRequest): Promise<Record<string, unknown>> {
    const response = await this.client().messages.create({
      model: request.model,
      max_tokens: 16000,
      system: request.system,
      tool_choice: { type: 'tool', name: request.tool.name },
      tools: [request.tool],
      messages: [{ role: 'user', content: request.user }]
    })
    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    return (toolUse?.input ?? {}) as Record<string, unknown>
  }

  async turn(request: TurnRequest): Promise<TurnResult> {
    const client = this.client()
    const stream = client.beta.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      // Route policy declines to a fallback model server-side (skill default).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: request.system,
      tools: request.tools,
      messages: request.messages
    } as Parameters<typeof client.beta.messages.stream>[0])
    if (request.onText) stream.on('text', request.onText)
    const message = await stream.finalMessage()
    return { content: message.content, stopReason: toStopReason(message.stop_reason) }
  }

  async complete(request: CompleteRequest): Promise<string> {
    const stream = this.client().messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }]
      },
      { signal: request.signal }
    )
    if (request.onToken) stream.on('text', request.onToken)
    const message = await stream.finalMessage()
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
}

function toStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_use':
    case 'refusal':
    case 'pause_turn':
    case 'max_tokens':
      return reason
    default:
      return 'end_turn'
  }
}
