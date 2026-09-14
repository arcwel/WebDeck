import { describe, it, expect } from 'vitest'
import { fitFor, recommendModels } from './recommend'

const GB = 1_000_000_000

describe('recommendModels', () => {
  it('points a 24 GB machine at qwen3.5:9b and calls 27b tight', () => {
    const r = recommendModels(24 * 1.0737 * GB)
    const byName = Object.fromEntries(r.models.map((m) => [m.model, m]))
    expect(byName['qwen3.5:9b']).toMatchObject({ fit: 'fits', recommended: true })
    expect(byName['qwen3.5:27b'].fit).toBe('tight')
    expect(byName['qwen3.5:35b-a3b'].fit).toBe('no')
    expect(r.models.filter((m) => m.recommended)).toHaveLength(1)
  })

  it('points an 8 GB machine at qwen3.5:4b', () => {
    const r = recommendModels(8 * 1.0737 * GB)
    const pick = r.models.find((m) => m.recommended)
    expect(pick?.model).toBe('qwen3.5:4b')
    expect(r.models.find((m) => m.model === 'qwen3.5:9b')?.fit).toBe('no')
  })

  it('points a 64 GB machine at the 9b still, with the large ones fitting', () => {
    const r = recommendModels(64 * 1.0737 * GB)
    expect(r.models.find((m) => m.recommended)?.model).toBe('qwen3.5:9b')
    expect(r.models.find((m) => m.model === 'qwen3.5:35b-a3b')?.fit).toBe('fits')
  })

  it('recommends nothing when nothing fits', () => {
    const r = recommendModels(2 * GB)
    expect(r.models.some((m) => m.recommended)).toBe(false)
    expect(fitFor(1, 0)).toBe('no')
  })
})
