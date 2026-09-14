import type Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ModelRuntimeStatus, ProviderId } from '@shared/models'

/**
 * The seam every model call goes through.
 *
 * The wire shapes are Anthropic's — messages as content blocks, tools as
 * `input_schema` — because that is what the agent loop was written against and
 * what Claude, the reference provider, speaks natively. A provider for another
 * runtime converts on the way in and out, and the conversion is what its tests
 * pin. Nothing about the loop, the tools, or the transcript knows which
 * provider answered.
 */
export type ChatMessage = Anthropic.Beta.BetaMessageParam
export type ToolDef = Anthropic.Tool
export type AssistantBlock = Anthropic.Beta.BetaContentBlock
export type StopReason = 'end_turn' | 'tool_use' | 'refusal' | 'pause_turn' | 'max_tokens'

/** One assistant turn of the agent loop: text streams, tool calls come back as blocks. */
export interface TurnRequest {
  model: string
  system: string
  messages: ChatMessage[]
  tools: ToolDef[]
  maxTokens: number
  onText?: (delta: string) => void
  /** The model's reasoning as it streams, for a runtime that reports it apart from the answer. */
  onThinking?: (delta: string) => void
  signal?: AbortSignal
}

export interface TurnResult {
  content: AssistantBlock[]
  stopReason: StopReason
}

/** The planning step: one structured answer shaped by a tool's schema. */
export interface PlanRequest {
  model: string
  system: string
  user: string
  tool: ToolDef
}

/** A one-shot streamed answer: Ask, chat with the page, an inline edit. */
export interface CompleteRequest {
  model: string
  system: string
  user: string
  maxTokens: number
  onToken?: (token: string) => void
  onThinking?: (delta: string) => void
  signal?: AbortSignal
}

export interface ModelProvider {
  readonly id: ProviderId
  listModels(): Promise<ModelInfo[]>
  status(): Promise<ModelRuntimeStatus>
  /** One status per runtime card, for a provider that fronts several endpoints. */
  statuses?(): Promise<ModelRuntimeStatus[]>
  turn(request: TurnRequest): Promise<TurnResult>
  /** Returns the tool's input — the structured plan — as the model filled it. */
  plan(request: PlanRequest): Promise<Record<string, unknown>>
  complete(request: CompleteRequest): Promise<string>
}
