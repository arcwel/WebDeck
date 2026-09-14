import { describe, it, expect } from 'vitest'
import { formatList, MODELS_USAGE } from './cli-models'
import type { ModelsListResult } from '@shared/models'

const result: ModelsListResult = {
  runtimes: [
    {
      provider: 'anthropic',
      id: 'anthropic',
      label: 'Claude',
      installed: true,
      running: false,
      detail: 'No API key'
    },
    {
      provider: 'ollama',
      id: 'ollama',
      label: 'Ollama',
      installed: true,
      running: true,
      detail: '1 model'
    },
    {
      provider: 'openai-compatible',
      id: 'endpoint:team',
      label: 'team',
      installed: true,
      running: true,
      custom: true,
      remote: true,
      detail: '1 model'
    },
    {
      provider: 'apple',
      id: 'apple',
      label: 'Apple on-device',
      installed: true,
      running: false,
      detail: 'Off'
    }
  ],
  models: [
    {
      id: 'anthropic/claude-opus-5',
      provider: 'anthropic',
      model: 'claude-opus-5',
      label: 'Claude Opus 5',
      local: false,
      capabilities: { tools: true, thinking: true, vision: true }
    },
    {
      id: 'ollama/qwen3.5:9b',
      provider: 'ollama',
      model: 'qwen3.5:9b',
      label: 'qwen3.5:9b',
      local: true,
      capabilities: { tools: true, thinking: true, vision: false },
      sizeBytes: 6_600_000_000
    },
    {
      id: 'openai-compatible/team/qwen-7b',
      provider: 'openai-compatible',
      model: 'team/qwen-7b',
      label: 'qwen-7b',
      local: false,
      capabilities: { tools: true, thinking: false, vision: false }
    }
  ],
  selection: { agent: 'ollama/qwen3.5:9b', ask: 'anthropic/claude-opus-5' }
}

describe('models CLI', () => {
  it('lists runtimes with their models beneath, and names what is in force', () => {
    const text = formatList(result)
    expect(text).toContain('Claude — not running · No API key')
    expect(text).toContain('  anthropic/claude-opus-5 · tools thinking vision · in force for ask')
    expect(text).toContain('Ollama — running · 1 model')
    expect(text).toContain('  ollama/qwen3.5:9b · 6.6 GB · tools thinking · in force for agent')
    expect(text).toContain('team — running · 1 model')
    expect(text).toContain('  openai-compatible/team/qwen-7b · tools')
    expect(text).toContain('Apple on-device — not running · Off')
    expect(text.trim().endsWith('ask:   anthropic/claude-opus-5')).toBe(true)
  })

  it('documents every subcommand in the usage text', () => {
    for (const word of ['list', 'use', 'pull', 'remove', 'test', 'recommend', 'endpoint']) {
      expect(MODELS_USAGE).toContain(`\n  ${word}`)
    }
  })
})
