import type { ModelInfo, ModelRuntimeStatus } from '@shared/models'

export function formatSize(bytes?: number): string {
  if (!bytes) return ''
  const gb = bytes / 1_000_000_000
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

export function formatContext(tokens?: number): string {
  if (!tokens) return ''
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k ctx` : `${tokens} ctx`
}

/** The models a runtime card lists: matched by provider, and for a compatible endpoint by its name. */
export function modelsOf(runtime: ModelRuntimeStatus, models: ModelInfo[]): ModelInfo[] {
  if (runtime.provider === 'openai-compatible') {
    const name = runtime.id === 'lmstudio' ? 'lmstudio' : runtime.id.replace(/^endpoint:/, '')
    return models.filter((m) => m.id.startsWith(`openai-compatible/${name}/`))
  }
  return models.filter((m) => m.provider === runtime.provider)
}

/** A model that runs here rather than in the cloud, by id. */
export function isLocalId(id: string): boolean {
  return !id.startsWith('anthropic/')
}
