import { IpcChannels } from '@shared/ipc'
import {
  parseModelId,
  type ModelInfo,
  type ModelRole,
  type ModelRuntimeStatus,
  type ModelSelection,
  type ModelsListResult,
  type ProviderId
} from '@shared/models'
import { core } from '../../rpc'
import { asString } from '../../coerce'
import { JsonStore } from '../json-store'
import type { ModelProvider } from './types'
import { OllamaProvider } from './ollama'

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
  cloudModel: () => string
  setCloudModel: (model: string) => void
}): void {
  const providers = new Map<ProviderId, ModelProvider>()
  providers.set('anthropic', options.anthropic)
  providers.set('ollama', options.ollama ?? new OllamaProvider())
  registry = { providers, cloudModel: options.cloudModel, setCloudModel: options.setCloudModel }
}

function need(): Registry {
  if (!registry) throw new Error('model registry not initialised')
  return registry
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
    const provider = providers.get(parsed.provider)
    if (provider) return { provider, model: parsed.model, id: local!, local: true }
  }
  const model = cloudModel()
  return { provider: providers.get('anthropic')!, model, id: `anthropic/${model}`, local: false }
}

export function selection(): ModelSelection {
  return { agent: activeModel('agent').id, ask: activeModel('ask').id }
}

export async function runtimeStatus(): Promise<ModelRuntimeStatus[]> {
  const { providers } = need()
  return Promise.all([...providers.values()].map((p) => p.status()))
}

export async function listModels(): Promise<ModelsListResult> {
  const { providers } = need()
  const lists = await Promise.all([...providers.values()].map((p) => p.listModels()))
  return { models: lists.flat(), selection: selection(), runtimes: await runtimeStatus() }
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
  const provider = providers.get(parsed.provider)
  if (!provider) throw new Error(`No provider for "${parsed.provider}".`)
  const status = await provider.status()
  if (!status.running) {
    throw new Error(
      status.installed
        ? 'Ollama is installed but not running. Start it from Settings → AI, or run `ollama serve`.'
        : 'Ollama is not installed on this machine.'
    )
  }
  const found = (await provider.listModels()).find((m) => m.id === id)
  if (!found)
    throw new Error(
      `"${parsed.model}" is not pulled. Pull it with \`ollama pull ${parsed.model}\`.`
    )
  if (role === 'agent' && !found.capabilities.tools) {
    throw new Error(`${found.model} cannot call tools, so it can answer Ask but not run the agent.`)
  }
  localStore.write({ ...choice, [role]: id })
  return listModels()
}

export async function startRuntime(provider: ProviderId): Promise<ModelRuntimeStatus> {
  const found = need().providers.get(provider)
  if (!found) throw new Error(`No provider for "${provider}".`)
  if (found instanceof OllamaProvider) return found.start()
  return found.status()
}

/** For the synchronous status the Agents block reads: is the local runtime known to be up? */
export function localRuntimeKnownRunning(): boolean {
  const ollama = registry?.providers.get('ollama')
  return ollama instanceof OllamaProvider ? ollama.lastKnownRunning : false
}

export function modelInfoFor(id: string, models: ModelInfo[]): ModelInfo | undefined {
  return models.find((m) => m.id === id)
}

export function registerModelsRpc(): void {
  core.register(IpcChannels.modelsList, () => listModels())
  core.register(IpcChannels.modelsUse, (role, id) => {
    const r = asString(role)
    if (r !== 'agent' && r !== 'ask') throw new Error('role must be agent or ask')
    return useModel(r, id === null ? null : (asString(id) ?? ''))
  })
  core.register(IpcChannels.modelsStatus, () => runtimeStatus())
  core.register(IpcChannels.modelsStart, (provider) => {
    const p = asString(provider)
    if (p !== 'anthropic' && p !== 'ollama') throw new Error('unknown provider')
    return startRuntime(p)
  })
}
