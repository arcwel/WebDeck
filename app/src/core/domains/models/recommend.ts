import { totalmem } from 'node:os'
import type { ModelRecommendation, ModelRecommendations } from '@shared/models'

/**
 * Which models to point a user at, sized to the machine.
 *
 * Chromium and a model share the same memory, so the ceiling is not "does it
 * load" but "does the browser stay usable beside it". A model whose working set
 * is under about two thirds of memory fits; up to nine tenths is tight; past
 * that it is not offered as a good idea. The working set is the download plus
 * the context and runtime overhead, which for a 32k context is a couple of
 * gigabytes on the small models and more on the large ones.
 *
 * Sizes are the Ollama library's default (4-bit) tags, checked 2026-09-14.
 */
const GB = 1_000_000_000

interface Candidate {
  model: string
  sizeBytes: number
  needsBytes: number
  note: string
}

const CANDIDATES: Candidate[] = [
  {
    model: 'qwen3.5:9b',
    sizeBytes: 6.6 * GB,
    needsBytes: 10 * GB,
    note: 'Tools, thinking and vision. The pick for 16 GB and up.'
  },
  {
    model: 'qwen3.5:4b',
    sizeBytes: 3.4 * GB,
    needsBytes: 5.5 * GB,
    note: 'Tools, thinking and vision. The pick for 8 GB.'
  },
  {
    model: 'qwen3.5:2b',
    sizeBytes: 2.7 * GB,
    needsBytes: 4 * GB,
    note: 'Small and quick; weaker at multi-step tasks.'
  },
  {
    model: 'qwen3.5:0.8b',
    sizeBytes: 1 * GB,
    needsBytes: 2.5 * GB,
    note: 'Tiny. Fine for Ask, not for the agent.'
  },
  {
    model: 'gemma3:4b',
    sizeBytes: 3.3 * GB,
    needsBytes: 5.5 * GB,
    note: 'Google’s; vision, no tool calling, so Ask only.'
  },
  {
    model: 'gemma3:12b',
    sizeBytes: 8.1 * GB,
    needsBytes: 12 * GB,
    note: 'Google’s; vision, no tool calling, so Ask only.'
  },
  {
    model: 'qwen3.5:27b',
    sizeBytes: 17 * GB,
    needsBytes: 21 * GB,
    note: 'Noticeably better at tools. For 32 GB and up.'
  },
  {
    model: 'qwen3.5:35b-a3b',
    sizeBytes: 24 * GB,
    needsBytes: 28 * GB,
    note: 'Mixture of experts: fast for its size. For 48 GB and up.'
  }
]

/** The order a new user is pointed at: the largest of these that fits. */
const PREFERRED = ['qwen3.5:9b', 'qwen3.5:4b', 'qwen3.5:2b', 'qwen3.5:0.8b']

const FITS_BELOW = 0.65
const TIGHT_BELOW = 0.9

export function fitFor(needsBytes: number, memoryBytes: number): ModelRecommendation['fit'] {
  if (memoryBytes <= 0) return 'no'
  const share = needsBytes / memoryBytes
  if (share <= FITS_BELOW) return 'fits'
  if (share <= TIGHT_BELOW) return 'tight'
  return 'no'
}

export function recommendModels(memoryBytes: number = totalmem()): ModelRecommendations {
  const models = CANDIDATES.map((c) => ({
    ...c,
    fit: fitFor(c.needsBytes, memoryBytes),
    recommended: false
  }))
  const pick = PREFERRED.find((name) => models.find((m) => m.model === name)?.fit === 'fits')
  return {
    memoryBytes,
    models: models.map((m) => (m.model === pick ? { ...m, recommended: true } : m))
  }
}
