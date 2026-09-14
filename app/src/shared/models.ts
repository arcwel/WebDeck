/**
 * Models the agent and the page assistant can run on, and where they run.
 *
 * A model id is provider-qualified — `anthropic/claude-opus-5`,
 * `ollama/qwen3.5:9b` — so the same picker can list a cloud model and one on
 * this machine side by side and nobody has to guess which is which. The
 * provider half decides who answers; the model half is that provider's own
 * name for it.
 */
export type ProviderId = 'anthropic' | 'ollama' | 'openai-compatible' | 'apple'

export const PROVIDER_IDS: readonly ProviderId[] = [
  'anthropic',
  'ollama',
  'openai-compatible',
  'apple'
]

/** The runtime an OpenAI-compatible endpoint is detected for, or one the user typed. */
export interface CustomEndpoint {
  /** A short name the model id carries: `openai-compatible/<name>/<model>`. */
  name: string
  /** The `/v1` base: `http://127.0.0.1:1234/v1`, `http://llm.internal:8000/v1`. */
  baseUrl: string
  /** A key is kept in the encrypted store, never here. */
  hasKey: boolean
}

/** What LM Studio answers on by default. */
export const LM_STUDIO_ENDPOINT = 'http://127.0.0.1:1234/v1'
export const LM_STUDIO_NAME = 'lmstudio'

/** Loopback means nothing leaves the machine; anything else is a network call. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    return (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

/** What a model is used for. The agent needs tools; Ask needs only text. */
export type ModelRole = 'agent' | 'ask'

export interface ModelCapabilities {
  /** Can call tools with JSON arguments — required to run the agent. */
  tools: boolean
  thinking: boolean
  vision: boolean
}

export interface ModelInfo {
  /** Provider-qualified: `ollama/qwen3.5:9b`. */
  id: string
  provider: ProviderId
  /** The provider's own name for it: `qwen3.5:9b`. */
  model: string
  label: string
  /** Runs on this machine; nothing leaves it. */
  local: boolean
  capabilities: ModelCapabilities
  contextLength?: number
  sizeBytes?: number
}

export interface ModelRuntimeStatus {
  provider: ProviderId
  /** One runtime per card: `ollama`, `lmstudio`, `endpoint:<name>`, `apple`, `anthropic`. */
  id: string
  label: string
  /** The runtime exists on this machine (a binary, an app, or for the cloud, always). */
  installed: boolean
  /** It answers: the local server is up, or the cloud provider has a key. */
  running: boolean
  endpoint?: string
  version?: string
  /** One line for the settings card: what is wrong, or what is loaded. */
  detail?: string
  /** A user-typed endpoint, which can be removed. */
  custom?: boolean
  /** Not on loopback: page text and files go over the network to it. */
  remote?: boolean
  /** The runtime can be started from here (a binary or CLI is on this machine). */
  startable?: boolean
  /** Where to get it when it is not installed. */
  installUrl?: string
}

/** Which model answers for each role, by id. */
export interface ModelSelection {
  agent: string
  ask: string
}

export interface ModelsListResult {
  models: ModelInfo[]
  selection: ModelSelection
  runtimes: ModelRuntimeStatus[]
}

export function parseModelId(id: string): { provider: ProviderId; model: string } | null {
  const slash = id.indexOf('/')
  if (slash === -1) {
    // A bare Claude id, as the settings stored it before providers existed.
    return id.startsWith('claude-') ? { provider: 'anthropic', model: id } : null
  }
  const provider = id.slice(0, slash)
  const model = id.slice(slash + 1)
  if (!model) return null
  if ((PROVIDER_IDS as readonly string[]).includes(provider)) {
    return { provider: provider as ProviderId, model }
  }
  return null
}

/** For `openai-compatible/<endpoint>/<model>`: which endpoint, and its own model name. */
export function splitEndpointModel(model: string): { endpoint: string; model: string } | null {
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) return null
  return { endpoint: model.slice(0, slash), model: model.slice(slash + 1) }
}

/** Progress of an Ollama pull, as the settings card shows it. */
export interface PullProgress {
  model: string
  status: string
  completed?: number
  total?: number
  done: boolean
  error?: string
}

/** A model worth pulling on a machine with this much memory. */
export interface ModelRecommendation {
  /** The Ollama tag: `qwen3.5:9b`. */
  model: string
  /** Download size, roughly. */
  sizeBytes: number
  /** Memory it wants while running, roughly: weights plus a working context. */
  needsBytes: number
  /** `fits`: comfortable here. `tight`: runs, with little left for the browser. `no`: more than this machine has. */
  fit: 'fits' | 'tight' | 'no'
  note: string
  /** The one to point a new user at on this machine. */
  recommended: boolean
}

export interface ModelRecommendations {
  memoryBytes: number
  models: ModelRecommendation[]
}

/** One short prompt, timed: what decides whether a local model is pleasant. */
export interface ModelTestResult {
  id: string
  /** Time to the first token. */
  firstTokenMs: number
  totalMs: number
  /** Streamed pieces, which for a local runtime is about one token each. */
  tokens: number
  tokensPerSecond: number
  /** The start of what it said, so a wrong answer is visible too. */
  sample: string
}
