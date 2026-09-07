import type { HistoryEntry } from '@/omnibox-rank'

/**
 * Which sites the start page shows, and who decided.
 *
 * The page used to show the eight most-visited sites and nothing else, which
 * is a fine default and a poor final answer: the site you go to most is not
 * always the one you want a tile for, and a site you visited once in a hurry
 * does not deserve one. So the user has two levers, both kept per profile:
 * pin a site, and it is always there, in front, in the order pinned; hide a
 * site, and history never puts it back. Everything else is still the most
 * visited, filling the tiles the pins leave.
 */
export interface StartSites {
  pinned: { url: string; title: string }[]
  hidden: string[]
}

export interface StartTile {
  url: string
  title: string
  favicon?: string
  pinned: boolean
}

export const emptyStartSites = (): StartSites => ({ pinned: [], hidden: [] })

/** The tiles, pins first then the most visited, never more than `limit`. */
export function startPageTiles(
  sites: StartSites,
  history: HistoryEntry[],
  limit: number
): StartTile[] {
  const byUrl = new Map(history.map((h) => [h.url, h]))
  const pinned: StartTile[] = sites.pinned.slice(0, limit).map((p) => {
    const known = byUrl.get(p.url)
    return {
      url: p.url,
      title: p.title || known?.title || hostLabel(p.url),
      favicon: known?.favicon,
      pinned: true
    }
  })
  const taken = new Set([...sites.hidden, ...pinned.map((t) => t.url)])
  const visited: StartTile[] = [...history]
    .filter((h) => !taken.has(h.url))
    .sort((a, b) => b.visitCount - a.visitCount || b.lastVisit - a.lastVisit)
    .slice(0, Math.max(0, limit - pinned.length))
    .map((h) => ({ url: h.url, title: h.title, favicon: h.favicon, pinned: false }))
  return [...pinned, ...visited]
}

/** A pin the user typed: anything a browser would navigate to, as a URL. */
export function normalizeSiteInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString()
  } catch {
    return null
  }
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}
