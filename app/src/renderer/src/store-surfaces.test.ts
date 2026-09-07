import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The Ask panel and the Dev Deck never share a window, and the Deck wins.
 * Pinned because both are toggled from many places — a key, a button, a
 * preset, a file opening — and the rule has to hold from every one of them.
 */

function installStorage(): void {
  const data = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size
      }
    }
  })
}

function installHost(canOpenWindows: boolean): void {
  ;(window as unknown as { agweb: unknown }).agweb = {
    host: {
      kind: 'chromium',
      ownsBrowserChrome: true,
      ownsBrowserFeatures: true,
      canOpenWindows,
      canPickPaths: false,
      canExport: false
    },
    windows: {
      broadcastState: vi.fn(),
      openDeck: vi.fn(),
      closeDeck: vi.fn(),
      syncFloats: vi.fn(),
      focusDeck: vi.fn()
    },
    appSettings: { readSync: () => ({ restoreTabs: true }) },
    browser: { destroy: vi.fn(async () => {}) },
    profiles: { list: vi.fn(async () => ({ profiles: [], activeId: '' })) }
  }
}

async function freshStore(): Promise<typeof import('./store')> {
  vi.resetModules()
  return import('./store')
}

describe('one surface at a time', () => {
  beforeEach(() => {
    installStorage()
    installHost(true)
  })

  it('opening Ask folds an attached Deck away', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.setState({ deckMode: 'attached', deckRevealed: true, assistantOpen: false })

    useShellStore.getState().openAssistant()

    expect(useShellStore.getState().assistantOpen).toBe(true)
    expect(useShellStore.getState().deckRevealed).toBe(false)
  })

  it('the Deck coming forward closes Ask, from any path', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.setState({ deckMode: 'attached', deckRevealed: false, assistantOpen: true })

    useShellStore.getState().toggleDeck()
    expect(useShellStore.getState().deckRevealed).toBe(true)
    expect(useShellStore.getState().assistantOpen).toBe(false)

    useShellStore.getState().openAssistant()
    useShellStore.getState().applyPreset('building')
    expect(useShellStore.getState().assistantOpen).toBe(false)

    useShellStore.getState().openAssistant()
    useShellStore.getState().openFile('/tmp/a.ts')
    expect(useShellStore.getState().deckRevealed).toBe(true)
    expect(useShellStore.getState().assistantOpen).toBe(false)
  })

  it('a detached Deck and Ask coexist', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.setState({ deckMode: 'detached', deckRevealed: true, assistantOpen: false })

    useShellStore.getState().openAssistant()

    expect(useShellStore.getState().assistantOpen).toBe(true)
    expect(useShellStore.getState().deckRevealed).toBe(true)
  })

  it('re-attaching the Deck closes Ask, since it is coming back into the window', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.setState({ deckMode: 'detached', deckRevealed: true, assistantOpen: true })

    useShellStore.getState().attachDeck()

    expect(useShellStore.getState().assistantOpen).toBe(false)
  })
})

describe('the Debugging preset is its own arrangement', () => {
  beforeEach(() => {
    installStorage()
    installHost(true)
  })

  it('differs from Building in more than a logs tab', async () => {
    const { useShellStore } = await freshStore()
    const zonesOf = (): Record<string, string[]> => {
      const s = useShellStore.getState()
      const out: Record<string, string[]> = {}
      for (const g of s.groups) {
        out[g.zone] = [...(out[g.zone] ?? []), ...g.blockIds.map((id) => s.blocks[id].type)]
      }
      return out
    }
    useShellStore.getState().applyPreset('building')
    const building = zonesOf()
    useShellStore.getState().applyPreset('debugging')
    const debugging = zonesOf()

    expect(building.left ?? []).not.toContain('files')
    expect(debugging.left).toContain('files')
    expect(debugging.right).toEqual(expect.arrayContaining(['editor', 'debug']))
    expect(debugging.bottom).toEqual(expect.arrayContaining(['logs', 'terminal', 'agents']))
    // Logs stand alone in their own group rather than as a tab beside the terminal.
    const s = useShellStore.getState()
    const logsGroup = s.groups.find((g) => g.blockIds.some((id) => s.blocks[id].type === 'logs'))!
    expect(logsGroup.blockIds).toHaveLength(1)
  })
})

describe("start page sites are the user's, per profile", () => {
  beforeEach(() => {
    installStorage()
    installHost(true)
  })

  it('pins, hides, and remembers across a fresh store', async () => {
    let mod = await freshStore()
    mod.useShellStore.getState().pinStartSite('https://a.com/', 'A')
    mod.useShellStore.getState().hideStartSite('https://b.com/')
    // Pinning a hidden site is a change of mind: it comes off the hidden list.
    mod.useShellStore.getState().hideStartSite('https://c.com/')
    mod.useShellStore.getState().pinStartSite('https://c.com/')

    mod = await freshStore()
    const sites = mod.useShellStore.getState().startSites
    expect(sites.pinned.map((p) => p.url)).toEqual(['https://a.com/', 'https://c.com/'])
    expect(sites.hidden).toEqual(['https://b.com/'])

    mod.useShellStore.getState().unhideStartSite('https://b.com/')
    mod.useShellStore.getState().unpinStartSite('https://a.com/')
    expect(mod.useShellStore.getState().startSites).toEqual({
      pinned: [{ url: 'https://c.com/', title: '' }],
      hidden: []
    })
  })

  it('switches with the profile', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.getState().pinStartSite('https://a.com/')
    useShellStore.getState().syncProfile('work')
    expect(useShellStore.getState().startSites.pinned).toEqual([])
    useShellStore.getState().syncProfile('default')
    expect(useShellStore.getState().startSites.pinned.map((p) => p.url)).toEqual(['https://a.com/'])
  })
})

describe('resizing a left column that opened by a drop', () => {
  it('starts from the width on screen, not from the 0 the store still holds', async () => {
    const { effectiveLeftWidth, DEFAULT_LEFT_WIDTH, clampDeckSizes } = await freshStore()
    const opened = clampDeckSizes({ colWidth: 436, leftWidth: 0, dockHeight: 248, dockWidths: {} })
    expect(opened.leftWidth).toBe(0)
    expect(effectiveLeftWidth(opened)).toBe(DEFAULT_LEFT_WIDTH)
    // A 90px rightward drag widens from the default, rather than clamping up from 0.
    const dragged = clampDeckSizes({ ...opened, leftWidth: effectiveLeftWidth(opened) + 90 })
    expect(dragged.leftWidth).toBe(DEFAULT_LEFT_WIDTH + 90)
  })
})

describe('who owns each bottom corner', () => {
  beforeEach(() => {
    installStorage()
    installHost(true)
  })

  it('gives both corners to the dock by default, and flips each side on its own', async () => {
    const { useShellStore, clampDeckSizes } = await freshStore()
    expect(useShellStore.getState().deckSizes.corners).toEqual({ left: 'dock', right: 'dock' })

    useShellStore.getState().toggleDeckCorner('left')
    expect(useShellStore.getState().deckSizes.corners).toEqual({ left: 'column', right: 'dock' })
    useShellStore.getState().toggleDeckCorner('right')
    useShellStore.getState().toggleDeckCorner('left')
    expect(useShellStore.getState().deckSizes.corners).toEqual({ left: 'dock', right: 'column' })

    // A layout saved before corners existed, or one with nonsense in it, reads as the default.
    expect(
      clampDeckSizes({ colWidth: 436, leftWidth: 0, dockHeight: 248, dockWidths: {} }).corners
    ).toEqual({ left: 'dock', right: 'dock' })
    expect(
      clampDeckSizes({
        colWidth: 436,
        leftWidth: 0,
        dockHeight: 248,
        dockWidths: {},
        corners: { left: 'sideways' as never, right: 'column' }
      }).corners
    ).toEqual({ left: 'dock', right: 'column' })
  })
})
