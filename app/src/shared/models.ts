/**
 * Models the agent and the page assistant can run on, and where they run.
 *
 * A model id is provider-qualified — `anthropic/claude-opus-5`,
 * `ollama/qwen3.5:9b` — so the same picker can list a cloud model and one on
 * this machine side by side and nobody has to guess which is which. The
 * provider half decides who answers; the model half is that provider's own
 * name for it.
 */
export type ProviderId = 'anthropic' | 'ollama'

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
  /** The runtime exists on this machine (a binary, an app, or for the cloud, always). */
  installed: boolean
  /** It answers: the local server is up, or the cloud provider has a key. */
  running: boolean
  endpoint?: string
  version?: string
  /** One line for the settings card: what is wrong, or what is loaded. */
  detail?: string
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
  if (provider === 'anthropic' || provider === 'ollama') return { provider, model }
  return null
}
