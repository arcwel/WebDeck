import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { delimiter, join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type { ModelInfo, ModelRuntimeStatus } from '@shared/models'
import type {
  AssistantBlock,
  ChatMessage,
  CompleteRequest,
  ModelProvider,
  PlanRequest,
  ToolDef,
  TurnRequest,
  TurnResult
} from './types'

/**
 * Ollama: a model on this machine, through its own API.
 *
 * Its native endpoints are used rather than its OpenAI-compatible ones because
 * they carry what the settings screen and the loop need and the compatible
 * ones do not: which models are installed and what each can do (`/api/show`
 * says `tools`, `thinking`, `vision` and the context length), a JSON schema for
 * the plan step (`format`), and the model's reasoning as its own stream
 * (`think`). Nothing here reaches past loopback unless the endpoint is
 * overridden on purpose.
 *
 * The wire shapes on the seam are Anthropic's, so this file is mostly
 * conversion in both directions, which is what its tests pin.
 */
export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'

/** How much context to ask for. Explicit: a runtime default of 2k or 4k
 *  silently truncates an agent turn that carries a file and a tool list. */
const NUM_CTX = 32_768

/** How long the discovery answer is trusted before it is asked again. */
const LIST_CACHE_MS = 20_000

const STATUS_TIMEOUT_MS = 1500
/** A plan is one answer, not a stream: a runtime that stalls on it must not
 *  hold the session in "planning" forever. Generous, for a big model on a
 *  laptop. */
const PLAN_TIMEOUT_MS = 180_000

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
  tool_name?: string
}

interface OllamaTool {
  type: 'function'
  function: { name: string; description?: string; parameters: unknown }
}

interface OllamaChatChunk {
  message?: {
    role?: string
    content?: string
    thinking?: string
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }>
  }
  done?: boolean
  done_reason?: string
  error?: string
}

/** Where an Ollama install usually puts its binary on a Mac. */
const BINARY_CANDIDATES = ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']

export function ollamaBinary(): string | null {
  for (const candidate of BINARY_CANDIDATES) if (existsSync(candidate)) return candidate
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, 'ollama'))) return join(dir, 'ollama')
  }
  return null
}

export function ollamaInstalled(): boolean {
  return ollamaBinary() !== null || existsSync('/Applications/Ollama.app')
}

/* ---- Conversion: Anthropic shapes on the seam → Ollama's ---- */

export function toOllamaTool(tool: ToolDef): OllamaTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema }
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (part && typeof part === 'object' && 'type' in part) {
        const p = part as { type: string; text?: string }
        if (p.type === 'text' && typeof p.text === 'string') return p.text
      }
      return ''
    })
    .join('')
}

/**
 * Anthropic messages to Ollama's. A user turn that answers tool calls becomes
 * one `tool` message per result, named after the call it answers — Ollama
 * pairs results with calls by name and order, not by id.
 */
export function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = []
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      const calls: OllamaMessage['tool_calls'] = []
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            toolNames.set(block.id, block.name)
            calls.push({
              function: {
                name: block.name,
                arguments: (block.input ?? {}) as Record<string, unknown>
              }
            })
          }
        }
      }
      out.push({
        role: 'assistant',
        content: text,
        ...(calls.length > 0 ? { tool_calls: calls } : {})
      })
      continue
    }
    if (typeof message.content === 'string') {
      out.push({ role: 'user', content: message.content })
      continue
    }
    const userText: string[] = []
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        out.push({
          role: 'tool',
          content: textOf(block.content),
          tool_name: toolNames.get(block.tool_use_id) ?? 'tool'
        })
      } else if (block.type === 'text') {
        userText.push(block.text)
      }
    }
    if (userText.length > 0) out.push({ role: 'user', content: userText.join('') })
  }
  return out
}

/* ---- The provider ---- */

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama' as const
  private listed: { at: number; models: ModelInfo[] } | null = null
  /** The last answer from status(), for the synchronous places that ask. */
  lastKnownRunning = false

  constructor(
    readonly endpoint: string = process.env.WEBDECK_OLLAMA_URL || DEFAULT_OLLAMA_ENDPOINT,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async status(): Promise<ModelRuntimeStatus> {
    const installed = ollamaInstalled() || this.endpoint !== DEFAULT_OLLAMA_ENDPOINT
    try {
      const response = await this.fetchImpl(`${this.endpoint}/api/version`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`${response.status}`)
      const { version } = (await response.json()) as { version?: string }
      this.lastKnownRunning = true
      const models = await this.listModels()
      return {
        provider: 'ollama',
        installed: true,
        running: true,
        endpoint: this.endpoint,
        version,
        detail:
          models.length === 0
            ? 'Running, no models pulled yet'
            : `${models.length} model${models.length === 1 ? '' : 's'}`
      }
    } catch (error) {
      this.lastKnownRunning = false
      const reason = error instanceof Error ? error.message : String(error)
      return {
        provider: 'ollama',
        installed,
        running: false,
        endpoint: this.endpoint,
        detail: installed ? `Installed, not running (${reason})` : 'Not installed'
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.listed && Date.now() - this.listed.at < LIST_CACHE_MS) return this.listed.models
    let tags: { models?: Array<{ name: string; size?: number }> }
    try {
      const response = await this.fetchImpl(`${this.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
      })
      if (!response.ok) return []
      tags = (await response.json()) as typeof tags
    } catch {
      return []
    }
    const models: ModelInfo[] = []
    // A probe that fails says nothing about the model. It is offered as able
    // to call tools — a wrong guess fails loudly at the runtime's door, where
    // a silent "cannot" would have hidden the model — and the list is not
    // cached, so the next look probes again.
    let probed = true
    for (const tag of tags.models ?? []) {
      // Embedding models answer no chat; they are not offered.
      const shown = await this.show(tag.name)
      if (!shown) probed = false
      const details = shown ?? { capabilities: ['completion', 'tools'] }
      if (details.capabilities.length > 0 && !details.capabilities.includes('completion')) continue
      models.push({
        id: `ollama/${tag.name}`,
        provider: 'ollama',
        model: tag.name,
        label: tag.name,
        local: true,
        capabilities: {
          tools: details.capabilities.includes('tools'),
          thinking: details.capabilities.includes('thinking'),
          vision: details.capabilities.includes('vision')
        },
        contextLength: details.contextLength,
        sizeBytes: tag.size
      })
    }
    if (probed) this.listed = { at: Date.now(), models }
    return models
  }

  private async show(
    name: string
  ): Promise<{ capabilities: string[]; contextLength?: number } | null> {
    try {
      const response = await this.fetchImpl(`${this.endpoint}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS * 2)
      })
      if (!response.ok) return null
      const body = (await response.json()) as {
        capabilities?: string[]
        model_info?: Record<string, unknown>
      }
      const contextKey = Object.keys(body.model_info ?? {}).find((k) =>
        k.endsWith('.context_length')
      )
      const context = contextKey ? body.model_info?.[contextKey] : undefined
      return {
        capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
        contextLength: typeof context === 'number' ? context : undefined
      }
    } catch {
      return null
    }
  }

  /** Whether the model is known to think, so the request asks for it. */
  private async thinks(model: string): Promise<boolean> {
    const known = (await this.listModels()).find((m) => m.model === model)
    return known?.capabilities.thinking ?? false
  }

  private async chat(
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onChunk: (chunk: OllamaChatChunk) => void
  ): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      throw this.describe(error)
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Ollama refused the request: ${detail || `${response.status} ${response.statusText}`}`
      )
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        if (line) {
          const chunk = JSON.parse(line) as OllamaChatChunk
          if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
          onChunk(chunk)
        }
        cut = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) {
      let chunk: OllamaChatChunk
      try {
        chunk = JSON.parse(buffer.trim()) as OllamaChatChunk
      } catch {
        throw new Error("Ollama's answer was cut off before it finished.")
      }
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)
      onChunk(chunk)
    }
  }

  /**
   * A transport failure as one sentence the user can act on. A stop the
   * caller asked for passes through untouched; a timeout says so; anything
   * else means the runtime is not answering at this endpoint.
   */
  private describe(error: unknown): Error {
    const name = error instanceof Error ? error.name : ''
    if (name === 'AbortError') return error as Error
    if (name === 'TimeoutError') return new Error('Ollama took too long to answer.')
    return new Error(
      `Ollama is not answering at ${this.endpoint}. Start it under Settings → AI, or run \`ollama serve\`.`
    )
  }

  async turn(request: TurnRequest): Promise<TurnResult> {
    let text = ''
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    let doneReason = 'stop'
    await this.chat(
      {
        model: request.model,
        stream: true,
        think: await this.thinks(request.model),
        options: { num_ctx: NUM_CTX, num_predict: request.maxTokens },
        messages: [
          { role: 'system', content: request.system },
          ...toOllamaMessages(request.messages)
        ],
        tools: request.tools.map(toOllamaTool)
      },
      request.signal,
      (chunk) => {
        const delta = chunk.message?.content ?? ''
        if (delta) {
          text += delta
          request.onText?.(delta)
        }
        for (const call of chunk.message?.tool_calls ?? []) {
          calls.push({
            name: call.function.name,
            input: parseArguments(call.function.name, call.function.arguments)
          })
        }
        if (chunk.done && chunk.done_reason) doneReason = chunk.done_reason
      }
    )
    const content: AssistantBlock[] = []
    if (text.trim()) content.push({ type: 'text', text, citations: null } as AssistantBlock)
    calls.forEach((call, index) => {
      content.push({
        type: 'tool_use',
        id: `call_${Date.now().toString(36)}_${index}`,
        name: call.name,
        input: call.input
      } as AssistantBlock)
    })
    return {
      content,
      stopReason:
        calls.length > 0 ? 'tool_use' : doneReason === 'length' ? 'max_tokens' : 'end_turn'
    }
  }

  /**
   * The plan: JSON shaped by the tool's own schema, which Ollama enforces
   * through `format`. A model that answers with something else gets one
   * stricter retry; after that the failure is reported rather than guessed at.
   */
  async plan(request: PlanRequest): Promise<Record<string, unknown>> {
    const attempt = async (extra: string): Promise<Record<string, unknown> | null> => {
      let text = ''
      await this.chat(
        {
          model: request.model,
          stream: false,
          think: await this.thinks(request.model),
          format: request.tool.input_schema,
          options: { num_ctx: NUM_CTX },
          messages: [
            { role: 'system', content: `${request.system}\n\n${request.tool.description ?? ''}` },
            { role: 'user', content: `${request.user}\n\nAnswer with JSON only.${extra}` }
          ]
        },
        AbortSignal.timeout(PLAN_TIMEOUT_MS),
        (chunk) => {
          text += chunk.message?.content ?? ''
        }
      )
      try {
        const parsed = JSON.parse(text) as unknown
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
      } catch {
        return null
      }
    }
    const first = await attempt('')
    if (first) return first
    const second = await attempt(
      ' The previous answer was not valid JSON. Return one JSON object matching the schema and nothing else.'
    )
    if (second) return second
    throw new Error('The local model did not return a usable plan.')
  }

  async complete(request: CompleteRequest): Promise<string> {
    let text = ''
    await this.chat(
      {
        model: request.model,
        stream: true,
        think: await this.thinks(request.model),
        options: { num_ctx: NUM_CTX, num_predict: request.maxTokens },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ]
      },
      request.signal,
      (chunk) => {
        const delta = chunk.message?.content ?? ''
        if (delta) {
          text += delta
          request.onToken?.(delta)
        }
      }
    )
    return text
  }

  /**
   * Start `ollama serve` when the binary is here and the server is not up.
   * Detached, so it outlives the core; polled until it answers or ten seconds
   * pass. Nothing is started that the user did not ask to start.
   */
  async start(): Promise<ModelRuntimeStatus> {
    const current = await this.status()
    if (current.running) return current
    const binary = ollamaBinary()
    if (!binary) return { ...current, detail: 'Ollama is not installed' }
    const child = spawn(binary, ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
    for (let waited = 0; waited < 10_000; waited += 500) {
      await new Promise((r) => setTimeout(r, 500))
      const status = await this.status()
      if (status.running) return status
    }
    return { ...(await this.status()), detail: 'Started, but it has not answered yet' }
  }
}

/**
 * A tool call's arguments, which Ollama sends as an object or as a JSON string.
 * Unreadable arguments end the turn rather than run the tool with an empty
 * input: an empty `{}` handed to run_command or delete_file is not a safe
 * default, it is a different call than the model made.
 */
function parseArguments(
  tool: string,
  args: Record<string, unknown> | string
): Record<string, unknown> {
  if (typeof args !== 'string') return args ?? {}
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    throw new Error(
      `The model's arguments for "${tool}" were not readable JSON; the call was not run.`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The model's arguments for "${tool}" were not an object; the call was not run.`)
  }
  return parsed as Record<string, unknown>
}

/** Keeps the seam's assistant blocks typed without re-declaring the SDK's unions. */
export type { Anthropic }
