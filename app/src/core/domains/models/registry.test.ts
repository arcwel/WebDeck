// @vitest-environment node
// The core runs under Node, and so does its fetch: the DOM environment the
// renderer tests use swaps AbortSignal for its own, which Node's fetch rejects.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { setCoreEnv } from '../../env'
import type { ModelInfo, ModelRuntimeStatus } from '@shared/models'
import type { ModelProvider } from './types'

const dir = join(tmpdir(), `wd-models-${process.pid}`)
mkdirSync(dir, { recursive: true })
setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

const {
  initModelRegistry,
  activeModel,
  useModel,
  selection,
  isPullableName,
  measure,
  addEndpoint,
  removeEndpoint,
  runtimeStatus
} = await import('./registry')

/** A provider that answers with whatever the test says it offers. */
function fake(
  id: 'anthropic' | 'ollama' | 'openai-compatible' | 'apple',
  models: ModelInfo[],
  status: Partial<ModelRuntimeStatus> = {}
): ModelProvider {
  return {
    id,
    listModels: async () => models,
    status: async () => ({
      provider: id,
      id,
      label: id,
      installed: true,
      running: true,
      ...status
    }),
    turn: async () => ({ content: [], stopReason: 'end_turn' }),
    plan: async () => ({}),
    complete: async () => ''
  }
}

const claude: ModelInfo = {
  id: 'anthropic/claude-opus-5',
  provider: 'anthropic',
  model: 'claude-opus-5',
  label: 'Claude',
  local: false,
  capabilities: { tools: true, thinking: true, vision: true }
}
const sonnet: ModelInfo = {
  ...claude,
  id: 'anthropic/claude-sonnet-5',
  model: 'claude-sonnet-5',
  label: 'Sonnet'
}
const qwen: ModelInfo = {
  id: 'ollama/qwen3.5:9b',
  provider: 'ollama',
  model: 'qwen3.5:9b',
  label: 'qwen3.5:9b',
  local: true,
  capabilities: { tools: true, thinking: true, vision: false }
}
const tiny: ModelInfo = {
  ...qwen,
  id: 'ollama/tiny',
  model: 'tiny',
  label: 'tiny',
  capabilities: { tools: false, thinking: false, vision: false }
}
const onDevice: ModelInfo = {
  id: 'apple/on-device',
  provider: 'apple',
  model: 'on-device',
  label: 'Apple on-device',
  local: true,
  capabilities: { tools: false, thinking: false, vision: false }
}

describe('which model answers', () => {
  let cloud = 'claude-opus-5'
  beforeEach(() => {
    rmSync(join(dir, 'ai-config.local.json'), { force: true })
    cloud = 'claude-opus-5'
    initModelRegistry({
      anthropic: fake('anthropic', [claude, sonnet]),
      ollama: fake('ollama', [qwen, tiny]),
      apple: fake('apple', [onDevice]),
      cloudModel: () => cloud,
      setCloudModel: (m) => (cloud = m)
    })
  })

  it("offers Apple's on-device model for Ask and refuses it for the agent by name", async () => {
    await expect(useModel('agent', 'apple/on-device')).rejects.toThrow(
      /Apple's on-device model answers Ask but cannot run the agent/
    )
    await useModel('ask', 'apple/on-device')
    expect(activeModel('ask')).toMatchObject({ id: 'apple/on-device', local: true })
  })

  it('reports one card per runtime, endpoints included', async () => {
    const ids = (await runtimeStatus()).map((s) => s.id)
    expect(ids).toEqual(['anthropic', 'ollama', 'lmstudio', 'apple'])
  })

  it('an endpoint is a card and a model source, and removing it clears a choice that named it', async () => {
    addEndpoint('team', 'http://127.0.0.1:1', undefined)
    expect((await runtimeStatus()).map((s) => s.id)).toContain('endpoint:team')
    await expect(useModel('ask', 'openai-compatible/team/x')).rejects.toThrow(
      /team is not answering at http:\/\/127\.0\.0\.1:1\/v1/
    )
    await expect(useModel('ask', 'openai-compatible/nowhere/x')).rejects.toThrow(
      /does not name a known endpoint/
    )
    const after = await removeEndpoint('team')
    expect(after.runtimes.map((s) => s.id)).not.toContain('endpoint:team')
  })

  it('is the synced cloud model until a local one is chosen', () => {
    expect(activeModel('agent')).toMatchObject({ id: 'anthropic/claude-opus-5', local: false })
    expect(selection()).toEqual({
      agent: 'anthropic/claude-opus-5',
      ask: 'anthropic/claude-opus-5'
    })
  })

  it('a local choice wins for its role only, and survives a fresh read', async () => {
    await useModel('ask', 'ollama/qwen3.5:9b')
    expect(activeModel('ask')).toMatchObject({
      id: 'ollama/qwen3.5:9b',
      local: true,
      model: 'qwen3.5:9b'
    })
    expect(activeModel('agent').local).toBe(false)
  })

  it('a cloud choice clears the local one and becomes the synced model', async () => {
    await useModel('agent', 'ollama/qwen3.5:9b')
    await useModel('agent', 'anthropic/claude-sonnet-5')
    expect(cloud).toBe('claude-sonnet-5')
    expect(activeModel('agent')).toMatchObject({ id: 'anthropic/claude-sonnet-5', local: false })
  })

  it('refuses a local model the agent could not run, and allows it for Ask', async () => {
    await expect(useModel('agent', 'ollama/tiny')).rejects.toThrow(/cannot call tools/)
    await useModel('ask', 'ollama/tiny')
    expect(activeModel('ask').id).toBe('ollama/tiny')
  })

  it('refuses what the runtime does not offer, and says why when it is down', async () => {
    await expect(useModel('agent', 'ollama/missing:7b')).rejects.toThrow(/not pulled/)
    await expect(useModel('agent', 'nonsense')).rejects.toThrow(/not a model id/)
    initModelRegistry({
      anthropic: fake('anthropic', [claude, sonnet]),
      ollama: fake('ollama', [], { running: false, installed: true }),
      cloudModel: () => cloud,
      setCloudModel: (m) => (cloud = m)
    })
    await expect(useModel('agent', 'ollama/qwen3.5:9b')).rejects.toThrow(/not running/)
  })

  it('refuses a cloud id the cloud provider does not offer', async () => {
    await expect(useModel('agent', 'anthropic/claude-nowhere-9')).rejects.toThrow(
      /not a Claude model this build offers/
    )
    expect(selection().agent).toBe('anthropic/claude-opus-5')
  })

  it('clearing goes back to the cloud', async () => {
    await useModel('agent', 'ollama/qwen3.5:9b')
    await useModel('agent', null)
    expect(activeModel('agent').local).toBe(false)
  })
})

describe('pull names and the test measurement', () => {
  it('accepts library tags and namespaced models, refuses anything else', () => {
    expect(isPullableName('qwen3.5:9b')).toBe(true)
    expect(isPullableName('gemma3')).toBe(true)
    expect(isPullableName('hf.co/org/model:Q4_K_M')).toBe(false)
    expect(isPullableName('org/model:tag')).toBe(true)
    expect(isPullableName('bad name')).toBe(false)
    expect(isPullableName(':tag')).toBe(false)
    expect(isPullableName('')).toBe(false)
  })

  it('measures first token and a rate from the streamed pieces', () => {
    const r = measure('ollama/x', '  hi there  ', 11, 1000, 1400, 2400)
    expect(r).toMatchObject({ firstTokenMs: 400, totalMs: 1400, tokens: 11, sample: 'hi there' })
    expect(r.tokensPerSecond).toBe(10)
    expect(measure('x', '', 0, 0, 5, 5)).toMatchObject({
      tokensPerSecond: 0,
      sample: expect.stringContaining('thinking')
    })
  })
})
