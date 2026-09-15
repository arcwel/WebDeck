import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The stage tab and the Editor-block tab that host VS Code's editor area for
 * extensions' custom editors: one stage tab at most, it never survives a
 * relaunch (its editors would not), and a file opening in the Editor block
 * takes the front from the Deck-side tab.
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

function installHost(): void {
  ;(window as unknown as { agweb: unknown }).agweb = {
    host: {
      kind: 'chromium',
      ownsBrowserChrome: true,
      ownsBrowserFeatures: true,
      canOpenWindows: true,
      canPickPaths: false,
      canExport: false
    },
    // Any shell call the store makes on a state change is a no-op here.
    shell: new Proxy({}, { get: () => vi.fn() }),
    windows: new Proxy({}, { get: () => vi.fn() }),
    appSettings: { readSync: () => ({ restoreTabs: true }) },
    browser: { destroy: vi.fn(async () => {}) },
    profiles: { list: vi.fn(async () => ({ profiles: [], activeId: '' })) }
  }
}

async function freshStore(): Promise<typeof import('./store')> {
  vi.resetModules()
  return import('./store')
}

describe('the extension editors tab', () => {
  beforeEach(() => {
    installStorage()
    installHost()
  })

  it('is one stage tab, created once and re-activated after', async () => {
    const { useShellStore, EDITORS_TAB_TITLE } = await freshStore()
    const before = useShellStore.getState().tabs.length
    useShellStore.getState().openEditorsTab()
    const first = useShellStore.getState()
    expect(first.tabs.length).toBe(before + 1)
    const tab = first.tabs.find((t) => t.kind === 'editors')
    expect(tab).toMatchObject({ title: EDITORS_TAB_TITLE, hasContent: false })
    expect(first.activeTabId).toBe(tab?.id)

    useShellStore.getState().activateTab(first.tabs[0].id)
    useShellStore.getState().openEditorsTab()
    const again = useShellStore.getState()
    expect(again.tabs.filter((t) => t.kind === 'editors')).toHaveLength(1)
    expect(again.activeTabId).toBe(tab?.id)
  })

  it('shows in the Editor block on request, and a file opening takes the front', async () => {
    const { useShellStore } = await freshStore()
    useShellStore.setState({ deckMode: 'attached', deckRevealed: false })
    useShellStore.getState().showEditorsInDeck()
    expect(useShellStore.getState()).toMatchObject({
      editorsInDeck: true,
      editorsTabActive: true,
      deckRevealed: true
    })
    useShellStore.getState().openFile('src/a.ts')
    expect(useShellStore.getState().editorsTabActive).toBe(false)
    expect(useShellStore.getState().editorsInDeck).toBe(true)
    useShellStore.getState().setEditorsTabActive(true)
    useShellStore.getState().closeEditorsInDeck()
    expect(useShellStore.getState()).toMatchObject({
      editorsInDeck: false,
      editorsTabActive: false
    })
  })
})
