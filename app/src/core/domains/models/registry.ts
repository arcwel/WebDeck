import { IpcChannels, IpcEvents } from '@shared/ipc'
import {
  parseModelId,
  splitEndpointModel,
  type CustomEndpoint,
  type ModelInfo,
  type ModelRecommendations,
  type ModelRole,
  type ModelRuntimeStatus,
  type ModelSelection,
  type ModelsListResult,
  type ModelTestResult,
  type ProviderId,
  type PullProgress
} from '@shared/models'
import { core } from '../../rpc'
import { asString } from '../../coerce'
import { coreBroadcast } from '../../notify'
import { JsonStore } from '../json-store'
import type { ModelProvider } from './types'
import { OllamaProvider } from './ollama'
import { OpenAICompatibleProvider } from './openai-compatible'
import { AppleProvider } from './apple'
import { recommendModels } from './recommend'

/**
 * Which model answers, for each role, and through which provider.
 *
 * Two stores, on purpose. The cloud choice (`ai-config.json`) is the one that
 * existed before providers did and the one WebDeck Sync carries between
 * machines. A local choice cannot travel — a model on this machine is not on
 * the next one — so it lives in `ai-config.local.json`, per machine, and wins
 * over the synced choice while it is set. Clearing it goes back to the cloud.
 */
interface LocalChoice {
  agent?: string
  ask?: string
}

const localStore = new JsonStore<LocalChoice>('ai-config.local', {})

interface Registry {
  providers: Map<ProviderId, ModelProvider>
  cloudModel: () => string
  setCloudModel: (model: string) => void
}

let registry: Registry | null = null

/** Wire the providers in. The agent module owns the Anthropic key resolution,
 *  so it hands the provider over rather than this module reaching for keys. */
export function initModelRegistry(options: {
  anthropic: ModelProvider
  ollama?: ModelProvider
  openaiCompatible?: ModelProvider
  apple?: ModelProvider
  cloudModel: () => string
  setCloudModel: (model: string) => void
}): void {
  const providers = new Map<ProviderId, ModelProvider>()
  providers.set('anthropic', options.anthropic)
  providers.set('ollama', options.ollama ?? new OllamaProvider())
  providers.set('openai-compatible', options.openaiCompatible ?? new OpenAICompatibleProvider())
  providers.set('apple', options.apple ?? new AppleProvider())
  registry = { providers, cloudModel: options.cloudModel, setCloudModel: options.setCloudModel }
}

function need(): Registry {
  if (!registry) throw new Error('model registry not initialised')
  return registry
}

function provider(id: ProviderId): ModelProvider {
  const found = need().providers.get(id)
  if (!found) throw new Error(`No provider for "${id}".`)
  return found
}

export interface ActiveModel {
  provider: ModelProvider
  /** The provider's own name for it. */
  model: string
  /** Provider-qualified. */
  id: string
  local: boolean
}

/** The model in force for a role: the machine's local choice, else the cloud one. */
export function activeModel(role: ModelRole): ActiveModel {
  const { providers, cloudModel } = need()
  const local = localStore.read()[role]
  const parsed = local ? parseModelId(local) : null
  if (parsed && parsed.provider !== 'anthropic') {
    const found = providers.get(parsed.provider)
    if (found) return { provider: found, model: parsed.model, id: local!, local: true }
  }
  const model = cloudModel()
  return { provider: providers.get('anthropic')!, model, id: `anthropic/${model}`, local: false }
}

export function selection(): ModelSelection {
  return { agent: activeModel('agent').id, ask: activeModel('ask').id }
}

/** One status per runtime card: a provider with several endpoints answers for each. */
export async function runtimeStatus(): Promise<ModelRuntimeStatus[]> {
  const { providers } = need()
  const lists = await Promise.all(
    [...providers.values()].map((p) => (p.statuses ? p.statuses() : p.status().then((s) => [s])))
  )
  return lists.flat()
}

export async function listModels(): Promise<ModelsListResult> {
  const { providers } = need()
  const lists = await Promise.all([...providers.values()].map((p) => p.listModels()))
  return { models: lists.flat(), selection: selection(), runtimes: await runtimeStatus() }
}

/** Why a model that is not offered is not offered, in the runtime's own terms. */
async function absentReason(id: ProviderId, model: string): Promise<string> {
  const p = provider(id)
  if (id === 'ollama') {
    const status = await p.status()
    if (!status.running) {
      return status.installed
        ? 'Ollama is installed but not running. Start it from Settings → AI, or run `ollama serve`.'
        : 'Ollama is not installed on this machine.'
    }
    return `"${model}" is not pulled. Pull it under Settings → AI, or run \`ollama pull ${model}\`.`
  }
  if (id === 'openai-compatible') {
    const split = splitEndpointModel(model)
    const statuses = p.statuses ? await p.statuses() : [await p.status()]
    const wanted = split?.endpoint === 'lmstudio' ? 'lmstudio' : `endpoint:${split?.endpoint}`
    const status = statuses.find((s) => s.id === wanted)
    if (!split || !status) return `"${model}" does not name a known endpoint.`
    if (!status.running) return `${status.label} is not answering at ${status.endpoint}.`
    return `${status.label} does not offer "${split.model}". Load it there first.`
  }
  if (id === 'apple') {
    const status = await p.status()
    return status.detail
      ? `Apple's on-device model: ${status.detail}`
      : "Apple's on-device model is not available."
  }
  return `"${model}" is not offered.`
}

/**
 * Choose a model for a role. A cloud id clears the machine's local choice and
 * becomes the synced choice; a local id is checked against what the runtime
 * actually offers — and, for the agent, that it can call tools — before it is
 * kept, so a choice that could never run is refused with the reason.
 */
export async function useModel(role: ModelRole, id: string | null): Promise<ModelsListResult> {
  const { providers, setCloudModel } = need()
  const choice = localStore.read()
  if (id === null) {
    delete choice[role]
    localStore.write(choice)
    return listModels()
  }
  const parsed = parseModelId(id)
  if (!parsed) throw new Error(`"${id}" is not a model id this build knows.`)
  if (parsed.provider === 'anthropic') {
    const cloud = providers.get('anthropic')
    const offered = cloud ? await cloud.listModels() : []
    if (!offered.some((m) => m.id === id)) {
      throw new Error(`"${parsed.model}" is not a Claude model this build offers.`)
    }
    setCloudModel(parsed.model)
    delete choice[role]
    localStore.write(choice)
    return listModels()
  }
  const found = (await provider(parsed.provider).listModels()).find((m) => m.id === id)
  if (!found) throw new Error(await absentReason(parsed.provider, parsed.model))
  if (role === 'agent' && !found.capabilities.tools) {
    throw new Error(
      parsed.provider === 'apple'
        ? "Apple's on-device model answers Ask but cannot run the agent."
        : `${found.label} cannot call tools, so it can answer Ask but not run the agent.`
    )
  }
  localStore.write({ ...choice, [role]: id })
  return listModels()
}

/** Start a runtime by its card id: `ollama`, or `lmstudio`. */
export async function startRuntime(runtime: string): Promise<ModelRuntimeStatus> {
  if (runtime === 'ollama') {
    const p = provider('ollama')
    return p instanceof OllamaProvider ? p.start() : p.status()
  }
  if (runtime === 'lmstudio') {
    const p = provider('openai-compatible')
    return p instanceof OpenAICompatibleProvider ? p.start() : p.status()
  }
  throw new Error(`"${runtime}" cannot be started from here.`)
}

/** For the synchronous status the Agents block reads: is the agent's local runtime known to be up? */
export function localRuntimeKnownRunning(): boolean {
  const active = registry ? activeModel('agent') : null
  if (!active || !active.local) return false
  const p = active.provider
  if (p instanceof OllamaProvider) return p.lastKnownRunning
  if (p instanceof OpenAICompatibleProvider) return p.lastKnownRunning(active.model)
  return false
}

export function modelInfoFor(id: string, models: ModelInfo[]): ModelInfo | undefined {
  return models.find((m) => m.id === id)
}

/* ---- Pulling and removing (Ollama) ---- */

let pulling: { model: string; controller: AbortController } | null = null

export function pullStatus(): PullProgress | null {
  return pulling ? { model: pulling.model, status: 'pulling', done: false } : null
}

/** What a pull may be asked for: a library tag, or `namespace/model:tag`. */
export function isPullableName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?(:[A-Za-z0-9._-]+)?$/.test(name)
}

/**
 * Pull a model in the background; progress goes to the shell as events, and
 * the last event carries `done` or `error`. One pull at a time: a second
 * request while one runs is refused rather than queued silently.
 */
export function pullModel(model: string): PullProgress {
  const p = provider('ollama')
  if (!(p instanceof OllamaProvider)) throw new Error('Pulling needs Ollama.')
  if (pulling) throw new Error(`Already pulling ${pulling.model}.`)
  const name = model.trim()
  if (!isPullableName(name)) {
    throw new Error('A model name looks like `qwen3.5:9b` or `library/model:tag`.')
  }
  const controller = new AbortController()
  pulling = { model: name, controller }
  const first: PullProgress = { model: name, status: 'starting', done: false }
  coreBroadcast(IpcEvents.modelsPull, first)
  void p
    .pull(name, (progress) => coreBroadcast(IpcEvents.modelsPull, progress), controller.signal)
    .then(() => coreBroadcast(IpcEvents.modelsPull, { model: name, status: 'success', done: true }))
    .catch((error: unknown) => {
      const aborted = error instanceof Error && error.name === 'AbortError'
      coreBroadcast(IpcEvents.modelsPull, {
        model: name,
        status: aborted ? 'cancelled' : 'error',
        done: true,
        error: aborted ? 'Pull cancelled.' : error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (pulling?.model === name) pulling = null
    })
  return first
}

export function cancelPull(): boolean {
  if (!pulling) return false
  pulling.controller.abort()
  return true
}

export async function removeModel(id: string): Promise<ModelsListResult> {
  const parsed = parseModelId(id)
  if (!parsed || parsed.provider !== 'ollama') {
    throw new Error('Only Ollama models can be removed here.')
  }
  const p = provider('ollama')
  if (!(p instanceof OllamaProvider)) throw new Error('Removing needs Ollama.')
  await p.remove(parsed.model)
  // A removed model cannot stay chosen: the roles that named it go back to the cloud.
  const choice = localStore.read()
  const next: LocalChoice = { ...choice }
  if (next.agent === id) delete next.agent
  if (next.ask === id) delete next.ask
  localStore.write(next)
  return listModels()
}

export function recommendations(): ModelRecommendations {
  return recommendModels()
}

/* ---- Test: one short prompt, timed ---- */

const TEST_PROMPT = 'In one sentence, what does a web browser do?'
/** Room for a thinking model to reason and still answer. */
const TEST_MAX_TOKENS = 1500
const TEST_TIMEOUT_MS = 120_000

/** Time a one-line answer through the seam: the number that decides whether a local model is pleasant. */
export async function testModel(id: string): Promise<ModelTestResult> {
  const parsed = parseModelId(id)
  if (!parsed) throw new Error(`"${id}" is not a model id this build knows.`)
  const p = provider(parsed.provider)
  const offered = (await p.listModels()).find((m) => m.id === id)
  if (!offered) throw new Error(await absentReason(parsed.provider, parsed.model))
  const started = performance.now()
  let first = 0
  let tokens = 0
  // Reasoning counts as generated tokens: the rate is the runtime's speed, and
  // for a thinking model the first token is a thought.
  const count = (): void => {
    tokens += 1
    if (!first) first = performance.now()
  }
  const text = await p.complete({
    model: parsed.model,
    system: 'Answer briefly.',
    user: TEST_PROMPT,
    maxTokens: TEST_MAX_TOKENS,
    onToken: count,
    onThinking: count,
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
  })
  const finished = performance.now()
  return measure(id, text, tokens, started, first || finished, finished)
}

export function measure(
  id: string,
  text: string,
  tokens: number,
  startedMs: number,
  firstMs: number,
  finishedMs: number
): ModelTestResult {
  const generating = Math.max(finishedMs - firstMs, 1)
  return {
    id,
    firstTokenMs: Math.round(firstMs - startedMs),
    totalMs: Math.round(finishedMs - startedMs),
    tokens,
    tokensPerSecond: tokens > 1 ? Math.round(((tokens - 1) / generating) * 1000 * 10) / 10 : 0,
    sample:
      text.trim().slice(0, 160) ||
      '(no answer within the token budget: the model spent it thinking)'
  }
}

/* ---- Endpoints (OpenAI-compatible) ---- */

function compatible(): OpenAICompatibleProvider {
  const p = provider('openai-compatible')
  if (!(p instanceof OpenAICompatibleProvider)) {
    throw new Error('Endpoints need the OpenAI-compatible provider.')
  }
  return p
}

export function addEndpoint(name: string, baseUrl: string, apiKey?: string): CustomEndpoint {
  return compatible().addEndpoint(name, baseUrl, apiKey)
}

export async function removeEndpoint(name: string): Promise<ModelsListResult> {
  compatible().removeEndpoint(name)
  const prefix = `openai-compatible/${name}/`
  const choice = localStore.read()
  const next: LocalChoice = { ...choice }
  if (next.agent?.startsWith(prefix)) delete next.agent
  if (next.ask?.startsWith(prefix)) delete next.ask
  localStore.write(next)
  return listModels()
}

export function registerModelsRpc(): void {
  core.register(IpcChannels.modelsList, () => listModels())
  core.register(IpcChannels.modelsUse, (role, id) => {
    const r = asString(role)
    if (r !== 'agent' && r !== 'ask') throw new Error('role must be agent or ask')
    return useModel(r, id === null ? null : (asString(id) ?? ''))
  })
  core.register(IpcChannels.modelsStatus, () => runtimeStatus())
  core.register(IpcChannels.modelsStart, (runtime) => startRuntime(asString(runtime) ?? ''))
  core.register(IpcChannels.modelsPull, (model) => pullModel(asString(model) ?? ''))
  core.register(IpcChannels.modelsPullStatus, () => pullStatus())
  core.register(IpcChannels.modelsCancelPull, () => cancelPull())
  core.register(IpcChannels.modelsRemove, (id) => removeModel(asString(id) ?? ''))
  core.register(IpcChannels.modelsRecommend, () => recommendations())
  core.register(IpcChannels.modelsTest, (id) => testModel(asString(id) ?? ''))
  core.register(IpcChannels.modelsEndpointAdd, (name, baseUrl, apiKey) =>
    addEndpoint(
      asString(name) ?? '',
      asString(baseUrl) ?? '',
      apiKey == null ? undefined : (asString(apiKey) ?? undefined)
    )
  )
  core.register(IpcChannels.modelsEndpointRemove, (name) => removeEndpoint(asString(name) ?? ''))
}
