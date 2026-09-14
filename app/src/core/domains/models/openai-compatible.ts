import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  isLoopbackUrl,
  LM_STUDIO_ENDPOINT,
  LM_STUDIO_NAME,
  splitEndpointModel,
  type CustomEndpoint,
  type ModelInfo,
  type ModelRuntimeStatus
} from '@shared/models'
import { JsonStore } from '../json-store'
import { clearEndpointKey, getEndpointKey, hasEndpointKey, setEndpointKey } from '../secrets'
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
 * Any server that speaks the OpenAI chat API: LM Studio, llama.cpp's server,
 * vLLM, Jan, a team's endpoint. One implementation covers them all, because
 * the wire is the same — `/v1/models` to see what is loaded, and
 * `/v1/chat/completions` with `tools` and `stream: true` for the loop.
 *
 * What this API does not carry, compared with Ollama's own: whether a model can
 * call tools (assumed yes; a model that cannot fails at the runtime's door with
 * its own message), its context length, or a streamed reasoning channel. So the
 * card shows what the server says and no more.
 *
 * Endpoints are per machine and never sync: an address that names a server on
 * this network means nothing on another machine, and a key is a secret. LM
 * Studio is a built-in endpoint on its default port; the rest are typed in.
 */
const STATUS_TIMEOUT_MS = 1500
const PLAN_TIMEOUT_MS = 180_000
/** Ten seconds for `lms server start` to answer. */
const START_WAIT_MS = 10_000

interface EndpointStore {
  endpoints: Array<{ name: string; baseUrl: string }>
}

const endpointStore = new JsonStore<EndpointStore>('ai-endpoints.local', { endpoints: [] })

/** A name is a path segment of a model id, so it is kept to what one can be. */
export function isEndpointName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)
}

export function normaliseBaseUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/v1')) path = `${path}/v1`
  url.pathname = path
  return url.toString().replace(/\/$/, '')
}

/* ---- LM Studio detection ---- */

const LM_STUDIO_APP = '/Applications/LM Studio.app'
const LMS_CLI = join(homedir(), '.lmstudio', 'bin', 'lms')

export function lmStudioInstalled(): boolean {
  return existsSync(LM_STUDIO_APP) || existsSync(LMS_CLI)
}

/* ---- Conversion: Anthropic shapes on the seam → OpenAI's ---- */

interface OpenAITool {
  type: 'function'
  function: { name: string; description?: string; parameters: unknown }
}

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export function toOpenAITool(tool: ToolDef): OpenAITool {
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
 * Anthropic messages to OpenAI's. Tool results keep their call ids, which is
 * how this API pairs them; the arguments travel as a JSON string.
 */
export function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      const calls: Extract<OpenAIMessage, { role: 'assistant' }>['tool_calls'] = []
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            calls.push({
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
            })
          }
        }
      }
      out.push({
        role: 'assistant',
        content: text || null,
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
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: textOf(block.content) })
      } else if (block.type === 'text') {
        userText.push(block.text)
      }
    }
    if (userText.length > 0) out.push({ role: 'user', content: userText.join('') })
  }
  return out
}

/* ---- Streaming: server-sent events, one chunk per line ---- */

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      /** Ollama's compatible endpoint streams a thinking model's reasoning here. */
      reasoning?: string | null
      /** vLLM and others name it this. */
      reasoning_content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string } | string
}

/** Parse one `data:` line; null for keep-alives and the `[DONE]` sentinel. */
export function parseSseLine(line: string): ChatChunk | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return null
  return JSON.parse(data) as ChatChunk
}

/**
 * Tool calls arrive as deltas keyed by index: the first carries the id and
 * name, the rest append to the arguments string. This gathers them into whole
 * calls once the stream ends.
 */
export class ToolCallAssembler {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>()

  add(delta: NonNullable<NonNullable<ChatChunk['choices']>[number]['delta']>['tool_calls']): void {
    for (const call of delta ?? []) {
      const index = call.index ?? 0
      const current = this.calls.get(index) ?? { id: '', name: '', args: '' }
      this.calls.set(index, {
        id: call.id || current.id,
        name: call.function?.name || current.name,
        args: current.args + (call.function?.arguments ?? '')
      })
    }
  }

  finish(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    return [...this.calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, call]) => ({
        id: call.id || `call_${Date.now().toString(36)}_${index}`,
        name: call.name,
        input: parseArguments(call.name, call.args)
      }))
  }
}

function parseArguments(tool: string, args: string): Record<string, unknown> {
  if (!args.trim()) return {}
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

/* ---- The provider ---- */

interface Endpoint extends CustomEndpoint {
  /** LM Studio's built-in card, never removable. */
  builtIn: boolean
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = 'openai-compatible' as const
  private readonly listed = new Map<string, { at: number; models: ModelInfo[] }>()
  private readonly running = new Map<string, boolean>()

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly lmStudioUrl: string = process.env.WEBDECK_LMSTUDIO_URL || LM_STUDIO_ENDPOINT
  ) {}

  /** LM Studio first, then what the user typed, in the order they typed it. */
  endpoints(): Endpoint[] {
    const custom = endpointStore
      .read()
      .endpoints.filter((e) => e.name !== LM_STUDIO_NAME)
      .map((e) => ({ ...e, hasKey: hasEndpointKey(e.name), builtIn: false }))
    return [
      { name: LM_STUDIO_NAME, baseUrl: this.lmStudioUrl, hasKey: false, builtIn: true },
      ...custom
    ]
  }

  endpoint(name: string): Endpoint | undefined {
    return this.endpoints().find((e) => e.name === name)
  }

  addEndpoint(name: string, baseUrl: string, apiKey?: string): CustomEndpoint {
    if (!isEndpointName(name)) {
      throw new Error('An endpoint name is lowercase letters, digits, - or _, up to 32 characters.')
    }
    if (name === LM_STUDIO_NAME) throw new Error('"lmstudio" is the built-in LM Studio endpoint.')
    const url = normaliseBaseUrl(baseUrl)
    if (!url) throw new Error('The address must be an http:// or https:// URL.')
    const store = endpointStore.read()
    const others = store.endpoints.filter((e) => e.name !== name)
    endpointStore.write({ endpoints: [...others, { name, baseUrl: url }] })
    if (apiKey !== undefined) {
      if (apiKey.trim() && !setEndpointKey(name, apiKey)) {
        throw new Error('This system has no OS keychain, so the key cannot be stored.')
      }
      if (!apiKey.trim()) clearEndpointKey(name)
    }
    this.listed.delete(name)
    return { name, baseUrl: url, hasKey: hasEndpointKey(name) }
  }

  removeEndpoint(name: string): void {
    if (name === LM_STUDIO_NAME) throw new Error('The LM Studio endpoint is built in.')
    const store = endpointStore.read()
    endpointStore.write({ endpoints: store.endpoints.filter((e) => e.name !== name) })
    clearEndpointKey(name)
    this.listed.delete(name)
    this.running.delete(name)
  }

  private headers(name: string): Record<string, string> {
    const key = getEndpointKey(name)
    return {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {})
    }
  }

  /** One status per endpoint: the cards in Settings. */
  async statuses(): Promise<ModelRuntimeStatus[]> {
    return Promise.all(this.endpoints().map((e) => this.statusOf(e)))
  }

  /** The seam's single status is LM Studio's, the endpoint that is always there. */
  async status(): Promise<ModelRuntimeStatus> {
    return this.statusOf(this.endpoints()[0])
  }

  private async statusOf(endpoint: Endpoint): Promise<ModelRuntimeStatus> {
    const base: ModelRuntimeStatus = {
      provider: 'openai-compatible',
      id: endpoint.builtIn ? LM_STUDIO_NAME : `endpoint:${endpoint.name}`,
      label: endpoint.builtIn ? 'LM Studio' : endpoint.name,
      installed: endpoint.builtIn ? lmStudioInstalled() : true,
      running: false,
      endpoint: endpoint.baseUrl,
      custom: !endpoint.builtIn,
      remote: !isLoopbackUrl(endpoint.baseUrl),
      startable: endpoint.builtIn && existsSync(LMS_CLI),
      installUrl: endpoint.builtIn ? 'https://lmstudio.ai' : undefined
    }
    const models = await this.modelsAt(endpoint)
    if (models === null) {
      this.running.set(endpoint.name, false)
      return {
        ...base,
        detail: endpoint.builtIn
          ? base.installed
            ? 'Installed, server not running'
            : 'Not installed'
          : `Not answering at ${endpoint.baseUrl}`
      }
    }
    this.running.set(endpoint.name, true)
    return {
      ...base,
      installed: true,
      running: true,
      detail:
        models.length === 0
          ? 'Running, no model loaded'
          : `${models.length} model${models.length === 1 ? '' : 's'}`
    }
  }

  /** Null when the server does not answer; a list (possibly empty) when it does. */
  private async modelsAt(endpoint: Endpoint): Promise<ModelInfo[] | null> {
    const cached = this.listed.get(endpoint.name)
    if (cached && Date.now() - cached.at < 20_000) return cached.models
    try {
      const response = await this.fetchImpl(`${endpoint.baseUrl}/models`, {
        headers: this.headers(endpoint.name),
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
      })
      if (!response.ok) return null
      const body = (await response.json()) as { data?: Array<{ id: string }> }
      const models: ModelInfo[] = (body.data ?? [])
        .filter((m) => typeof m.id === 'string' && m.id)
        // Embedding models answer no chat; the common names are left out.
        .filter((m) => !/embed/i.test(m.id))
        .map((m) => ({
          id: `openai-compatible/${endpoint.name}/${m.id}`,
          provider: 'openai-compatible' as const,
          model: `${endpoint.name}/${m.id}`,
          label: m.id,
          local: isLoopbackUrl(endpoint.baseUrl),
          // The API does not say. Tools are assumed, because refusing every
          // model would hide the ones that can; a model that cannot fails at
          // the server with its own message.
          capabilities: { tools: true, thinking: false, vision: false }
        }))
      this.listed.set(endpoint.name, { at: Date.now(), models })
      return models
    } catch {
      return null
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const lists = await Promise.all(this.endpoints().map((e) => this.modelsAt(e)))
    return lists.flatMap((l) => l ?? [])
  }

  /** Whether the endpoint a model id names answered the last time it was asked. */
  lastKnownRunning(model: string): boolean {
    const split = splitEndpointModel(model)
    return split ? (this.running.get(split.endpoint) ?? false) : false
  }

  private resolve(model: string): { endpoint: Endpoint; model: string } {
    const split = splitEndpointModel(model)
    const endpoint = split ? this.endpoint(split.endpoint) : undefined
    if (!split || !endpoint) throw new Error(`"${model}" does not name a known endpoint.`)
    return { endpoint, model: split.model }
  }

  private async chat(
    endpoint: Endpoint,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onChunk: (chunk: ChatChunk) => void
  ): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(endpoint.name),
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      throw this.describe(endpoint, error)
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `${endpoint.builtIn ? 'LM Studio' : endpoint.name} refused the request: ${
          detail.slice(0, 300) || `${response.status} ${response.statusText}`
        }`
      )
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const handle = (line: string): void => {
      const chunk = parseSseLine(line)
      if (!chunk) return
      if (chunk.error) {
        const message = typeof chunk.error === 'string' ? chunk.error : chunk.error.message
        throw new Error(`${endpoint.builtIn ? 'LM Studio' : endpoint.name}: ${message}`)
      }
      onChunk(chunk)
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        handle(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) handle(buffer)
  }

  private describe(endpoint: Endpoint, error: unknown): Error {
    const name = error instanceof Error ? error.name : ''
    if (name === 'AbortError') return error as Error
    const label = endpoint.builtIn ? 'LM Studio' : endpoint.name
    if (name === 'TimeoutError') return new Error(`${label} took too long to answer.`)
    return new Error(
      endpoint.builtIn
        ? `LM Studio is not answering at ${endpoint.baseUrl}. Start its server from Settings → AI, or in LM Studio.`
        : `${endpoint.name} is not answering at ${endpoint.baseUrl}.`
    )
  }

  async turn(request: TurnRequest): Promise<TurnResult> {
    const { endpoint, model } = this.resolve(request.model)
    let text = ''
    const assembler = new ToolCallAssembler()
    let finish: string | null = null
    await this.chat(
      endpoint,
      {
        model,
        stream: true,
        max_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          ...toOpenAIMessages(request.messages)
        ],
        ...(request.tools.length > 0 ? { tools: request.tools.map(toOpenAITool) } : {})
      },
      request.signal,
      (chunk) => {
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta?.content ?? ''
          if (delta) {
            text += delta
            request.onText?.(delta)
          }
          const thinking = choice.delta?.reasoning ?? choice.delta?.reasoning_content ?? ''
          if (thinking) request.onThinking?.(thinking)
          assembler.add(choice.delta?.tool_calls)
          if (choice.finish_reason) finish = choice.finish_reason
        }
      }
    )
    const calls = assembler.finish()
    const content: AssistantBlock[] = []
    if (text.trim()) content.push({ type: 'text', text, citations: null } as AssistantBlock)
    for (const call of calls) {
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: call.input
      } as AssistantBlock)
    }
    return {
      content,
      stopReason: calls.length > 0 ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn'
    }
  }

  /**
   * The plan as JSON shaped by the tool's schema. Servers that support
   * `response_format: json_schema` enforce it; one that refuses the field gets
   * the schema in the prompt instead, and either way the answer is parsed and
   * retried once before the failure is reported.
   */
  async plan(request: PlanRequest): Promise<Record<string, unknown>> {
    const { endpoint, model } = this.resolve(request.model)
    const system = `${request.system}\n\n${request.tool.description ?? ''}`
    const schemaText = JSON.stringify(request.tool.input_schema)
    const attempt = async (
      withFormat: boolean,
      extra: string
    ): Promise<Record<string, unknown> | null> => {
      let text = ''
      await this.chat(
        endpoint,
        {
          model,
          stream: true,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: `${request.user}\n\nAnswer with one JSON object matching this schema and nothing else:\n${schemaText}${extra}`
            }
          ],
          ...(withFormat
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: request.tool.name, schema: request.tool.input_schema }
                }
              }
            : {})
        },
        AbortSignal.timeout(PLAN_TIMEOUT_MS),
        (chunk) => {
          for (const choice of chunk.choices ?? []) text += choice.delta?.content ?? ''
        }
      )
      return parseJsonObject(text)
    }
    let first: Record<string, unknown> | null
    try {
      first = await attempt(true, '')
    } catch (error) {
      // A server that does not know response_format says so with a 4xx; the
      // prompt already carries the schema, so ask again without the field.
      if (!/refused the request/.test(error instanceof Error ? error.message : '')) throw error
      first = await attempt(false, '')
    }
    if (first) return first
    const second = await attempt(
      false,
      ' The previous answer was not valid JSON. Return one JSON object matching the schema and nothing else.'
    )
    if (second) return second
    throw new Error('The model did not return a usable plan.')
  }

  async complete(request: CompleteRequest): Promise<string> {
    const { endpoint, model } = this.resolve(request.model)
    let text = ''
    await this.chat(
      endpoint,
      {
        model,
        stream: true,
        max_tokens: request.maxTokens,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ]
      },
      request.signal,
      (chunk) => {
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta?.content ?? ''
          if (delta) {
            text += delta
            request.onToken?.(delta)
          }
          const thinking = choice.delta?.reasoning ?? choice.delta?.reasoning_content ?? ''
          if (thinking) request.onThinking?.(thinking)
        }
      }
    )
    return text
  }

  /** `lms server start`, when LM Studio's CLI is installed; polled until it answers. */
  async start(): Promise<ModelRuntimeStatus> {
    const lmStudio = this.endpoints()[0]
    this.listed.delete(lmStudio.name)
    const current = await this.statusOf(lmStudio)
    if (current.running) return current
    if (!existsSync(LMS_CLI)) {
      return { ...current, detail: 'Start the server in LM Studio (Developer → Start Server)' }
    }
    const child = spawn(LMS_CLI, ['server', 'start'], { detached: true, stdio: 'ignore' })
    child.unref()
    for (let waited = 0; waited < START_WAIT_MS; waited += 500) {
      await new Promise((r) => setTimeout(r, 500))
      this.listed.delete(lmStudio.name)
      const status = await this.statusOf(lmStudio)
      if (status.running) return status
    }
    return { ...(await this.statusOf(lmStudio)), detail: 'Started, but it has not answered yet' }
  }
}

/** The first JSON object in a reply, tolerating a model that wraps it in a fence. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
