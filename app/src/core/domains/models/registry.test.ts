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

const { initModelRegistry, activeModel, useModel, selection } = await import('./registry')

/** A provider that answers with whatever the test says it offers. */
function fake(
  id: 'anthropic' | 'ollama',
  models: ModelInfo[],
  status: Partial<ModelRuntimeStatus> = {}
): ModelProvider {
  return {
    id,
    listModels: async () => models,
    status: async () => ({ provider: id, installed: true, running: true, ...status }),
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

describe('which model answers', () => {
  let cloud = 'claude-opus-5'
  beforeEach(() => {
    rmSync(join(dir, 'ai-config.local.json'), { force: true })
    cloud = 'claude-opus-5'
    initModelRegistry({
      anthropic: fake('anthropic', [claude, sonnet]),
      ollama: fake('ollama', [qwen, tiny]),
      cloudModel: () => cloud,
      setCloudModel: (m) => (cloud = m)
    })
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
