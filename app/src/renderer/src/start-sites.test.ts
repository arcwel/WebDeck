import { describe, it, expect } from 'vitest'
import { normalizeSiteInput, startPageTiles } from './start-sites'
import type { HistoryEntry } from './omnibox-rank'

const visit = (url: string, visitCount: number, title = url): HistoryEntry => ({
  url,
  title,
  visitCount,
  lastVisit: 1
})

describe('startPageTiles', () => {
  const history = [
    visit('https://a.com/', 9),
    visit('https://b.com/', 5),
    visit('https://c.com/', 1)
  ]

  it('shows the most visited when nothing is chosen', () => {
    expect(startPageTiles({ pinned: [], hidden: [] }, history, 8).map((t) => t.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
      'https://c.com/'
    ])
  })

  it('puts pins first, in pin order, and never repeats them from history', () => {
    const tiles = startPageTiles(
      {
        pinned: [
          { url: 'https://c.com/', title: '' },
          { url: 'https://new.dev/', title: 'New' }
        ],
        hidden: []
      },
      history,
      8
    )
    expect(tiles.map((t) => t.url)).toEqual([
      'https://c.com/',
      'https://new.dev/',
      'https://a.com/',
      'https://b.com/'
    ])
    expect(tiles[0].pinned).toBe(true)
    expect(tiles[1].title).toBe('New')
    expect(tiles[2].pinned).toBe(false)
  })

  it('never shows a hidden site, however often it was visited', () => {
    const tiles = startPageTiles({ pinned: [], hidden: ['https://a.com/'] }, history, 8)
    expect(tiles.map((t) => t.url)).toEqual(['https://b.com/', 'https://c.com/'])
  })

  it('keeps to the limit with pins counted', () => {
    const tiles = startPageTiles(
      { pinned: [{ url: 'https://p.com/', title: '' }], hidden: [] },
      history,
      2
    )
    expect(tiles.map((t) => t.url)).toEqual(['https://p.com/', 'https://a.com/'])
  })

  it('titles a pin from history when it has one, else from the host', () => {
    const tiles = startPageTiles(
      {
        pinned: [
          { url: 'https://a.com/', title: '' },
          { url: 'https://www.zed.dev/', title: '' }
        ],
        hidden: []
      },
      history,
      8
    )
    expect(tiles[0].title).toBe('https://a.com/')
    expect(tiles[1].title).toBe('zed.dev')
  })
})

describe('normalizeSiteInput', () => {
  it('accepts a bare host and a full address', () => {
    expect(normalizeSiteInput('example.com')).toBe('https://example.com/')
    expect(normalizeSiteInput(' http://localhost:3000/app ')).toBe('http://localhost:3000/app')
  })

  it('refuses what a start tile cannot open', () => {
    expect(normalizeSiteInput('')).toBeNull()
    expect(normalizeSiteInput('just words')).toBeNull()
    expect(normalizeSiteInput('javascript:alert(1)')).toBeNull()
    expect(normalizeSiteInput('file:///etc/passwd')).toBeNull()
  })
})
