import { useEffect } from 'react'
import { useShellStore } from '@/store'
import { registerShortcut } from '@/shortcuts'
import { navigateTab } from '@/components/Toolbar'

/**
 * The commands behind the native application menu.
 *
 * The menu sends `app:*` strings over the same channel the shell already uses
 * for shortcuts pressed while a page had focus, so these register in the
 * shortcut registry alongside real combos. That keeps a menu item and its
 * accelerator on one handler instead of two that drift apart, and it means the
 * menu can drive anything the shell can do — including work that only the page
 * process can perform (print, zoom, devtools), which is why several of these
 * go back out over IPC rather than touching the DOM.
 *
 * The same actions are the source for the ⌘K command palette (see
 * `buildCommands`). Rather than duplicate them, the palette enumerates a
 * data structure whose entries call straight into `runMenuCommand` (for the
 * menu-backed actions) or into the store directly (for tab/deck/theme work
 * the menu never exposed). One definition, two front-ends.
 */

/** True on macOS, so shortcut hints render ⌘ instead of Ctrl. */
const IS_MAC = navigator.platform.toUpperCase().includes('MAC')

/** The native-menu commands, registered as shortcuts so menu + accelerator
 *  share one handler. */
const MENU_COMMANDS = [
  'app:settings',
  'app:new-window',
  'app:new-incognito',
  'app:save',
  'app:print',
  'app:find',
  'app:reload',
  'app:force-reload',
  'app:zoom-reset',
  'app:zoom-in',
  'app:zoom-out',
  'app:utilities',
  'app:split',
  'app:devtools',
  'app:back',
  'app:forward',
  'app:home',
  'app:reopen-tab'
] as const

/**
 * Run one native-menu command. Kept as a free function (not a hook) so both
 * the shortcut registry and the command palette can call it.
 */
export async function runMenuCommand(command: string): Promise<void> {
  const store = useShellStore.getState()
  const tabId = store.activeTabId

  // ⌘1…⌘8 / ⌘9 from the browser (see ShellClient.OnCommand): the shell's own
  // ⌘1–3 layout presets only fire when the shell has focus; with the page
  // focused these arrive as Chromium's tab-selection commands and select tabs.
  if (command.startsWith('app:select-tab-')) {
    const which = command.slice('app:select-tab-'.length)
    const ids = store.tabs.map((t) => t.id)
    const id = which === 'last' ? ids[ids.length - 1] : ids[Number(which) - 1]
    if (id) store.activateTab(id)
    return
  }

  switch (command) {
    // Commands the browser forwards when the PAGE has focus. The same actions
    // the shell's own shortcuts run; here they arrive over Mojo instead.
    case 'app:new-tab':
      store.newTab()
      return

    case 'app:close-tab':
      store.closeTab(tabId)
      return

    case 'app:next-tab':
    case 'app:prev-tab': {
      const ids = store.tabs.map((t) => t.id)
      if (ids.length < 2) return
      const i = ids.indexOf(tabId)
      const step = command === 'app:next-tab' ? 1 : ids.length - 1
      store.activateTab(ids[(i + step) % ids.length])
      return
    }

    case 'app:focus-address': {
      const input = document.querySelector<HTMLInputElement>('input[placeholder^="Enter URL"]')
      input?.focus()
      input?.select()
      return
    }

    case 'app:find-next':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true }))
      return

    case 'app:find-prev':
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'g', metaKey: true, shiftKey: true })
      )
      return

    case 'app:bookmark': {
      const state = store.browserStates[tabId]
      if (!state?.url) return
      if (store.bookmarks.some((b) => b.url === state.url)) store.removeBookmark(state.url)
      else store.addBookmark(state.url, state.title)
      return
    }

    case 'app:toggle-deck':
      store.toggleDeck()
      return

    // 'preferences' is the File menu's Settings item (IDC_OPTIONS), forwarded
    // by the browser so it opens this one sheet rather than a chrome:// tab.
    case 'app:preferences':
    case 'app:settings':
      // Settings opens as its own overlay, not a deck block — it configures
      // the app and browser, not the developer workspace.
      store.setSettingsOpen(true)
      return

    case 'app:new-window':
      await window.agweb.windows.newWindow()
      return

    case 'app:new-incognito':
      // Switch into the incognito profile and open a fresh private tab.
      await window.agweb.profiles.setActive('incognito')
      store.syncProfile('incognito')
      store.newTab()
      return

    case 'app:save':
      // Editors own their own buffers; the one with focus takes the save.
      window.dispatchEvent(new CustomEvent('agweb:save'))
      return

    case 'app:print':
      await window.agweb.browser.print(tabId)
      return

    case 'app:find':
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))
      return

    case 'app:reload':
      await window.agweb.browser.reload(tabId)
      return

    case 'app:force-reload':
      // ⌘⇧R bypasses the cache, as it does in Chrome.
      await window.agweb.browser.reload(tabId, true)
      return

    case 'app:zoom-reset':
      // The IPC layer speaks Chromium zoom *levels*, where 0 is 100% — the
      // same units the toolbar's ZoomControls uses. (An earlier version set
      // level 1 here, which is ~120%, so "Actual Size" didn't restore 100%.)
      await window.agweb.browser.zoom(tabId, 0)
      return

    case 'app:zoom-in':
    case 'app:zoom-out': {
      const current = await window.agweb.browser.zoom(tabId)
      await window.agweb.browser.zoom(tabId, current + (command === 'app:zoom-in' ? 1 : -1))
      return
    }

    case 'app:utilities':
      store.setUtilitiesOpen(!store.utilitiesOpen)
      return

    case 'app:split':
      store.toggleSplit()
      return

    case 'app:devtools':
      await window.agweb.browser.openDevTools(tabId)
      return

    case 'app:back':
      await window.agweb.browser.back(tabId)
      return

    case 'app:forward':
      await window.agweb.browser.forward(tabId)
      return

    case 'app:home':
      await navigateTab(tabId, store.homeUrl)
      return

    case 'app:reopen-tab':
      store.reopenTab()
      return
  }
}

/** Reveal or hide the Dev Deck — focusing a detached deck rather than
 *  toggling it, matching the ⌘D binding in App.tsx. */
function toggleDeck(): void {
  const store = useShellStore.getState()
  if (store.deckMode === 'detached') void window.agweb.windows.focusDeck()
  else store.toggleDeck()
}

/** A section groups related commands in the palette. */
export type CommandSection =
  | 'Tabs'
  | 'Navigation'
  | 'Dev Deck'
  | 'Snapshots'
  | 'View'
  | 'Application'
  // VS Code's built-in editor commands + everything installed extensions
  // contribute (12.8) — see editor-commands.ts.
  | 'Editor & Extensions'

/** One entry in the command palette. `run` performs the action; the palette
 *  closes itself around it. */
export interface AppCommand {
  id: string
  title: string
  section: CommandSection
  /** Extra terms the fuzzy search should match beyond the title. */
  keywords?: string
  /** A pre-formatted, platform-correct hint like "⌘K" (display only). */
  shortcut?: string
  /** Where an editor/extension command comes from — the extension's name. */
  badge?: string
  run: () => void | Promise<void>
}

/** Callbacks the palette wires in for commands that open other overlays. */
export interface CommandContext {
  openTabSwitcher: () => void
}

/** Format a combo as a display hint: "mod+shift+t" → "⌘⇧T" / "Ctrl+Shift+T". */
function hint(combo: string): string {
  const parts = combo.split('+').map((p) => {
    switch (p) {
      case 'mod':
        return IS_MAC ? '⌘' : 'Ctrl'
      case 'shift':
        return IS_MAC ? '⇧' : 'Shift'
      case 'alt':
        return IS_MAC ? '⌥' : 'Alt'
      default:
        return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
    }
  })
  return IS_MAC ? parts.join('') : parts.join('+')
}

/**
 * The full set of commands the palette enumerates. Built fresh each open so
 * store-reading commands see live state; `ctx` supplies openers for the
 * overlays a command can raise (e.g. the tab switcher).
 */
export function buildCommands(ctx: CommandContext): AppCommand[] {
  const store = (): ReturnType<typeof useShellStore.getState> => useShellStore.getState()

  return [
    // Tabs
    {
      id: 'new-tab',
      title: 'New Tab',
      section: 'Tabs',
      keywords: 'open create page',
      shortcut: hint('mod+t'),
      run: () => store().newTab()
    },
    {
      id: 'close-tab',
      title: 'Close Tab',
      section: 'Tabs',
      keywords: 'quit',
      shortcut: hint('mod+w'),
      run: () => store().closeTab(store().activeTabId)
    },
    {
      id: 'reopen-tab',
      title: 'Reopen Closed Tab',
      section: 'Tabs',
      keywords: 'restore undo',
      shortcut: hint('mod+shift+t'),
      run: () => runMenuCommand('app:reopen-tab')
    },
    {
      id: 'switch-tab',
      title: 'Switch Tab…',
      section: 'Tabs',
      keywords: 'jump go find open tab switcher',
      shortcut: hint('mod+shift+a'),
      run: () => ctx.openTabSwitcher()
    },
    {
      id: 'split-view',
      title: 'Toggle Split View',
      section: 'Tabs',
      keywords: 'side by side pane',
      run: () => runMenuCommand('app:split')
    },

    // Navigation
    {
      id: 'reload',
      title: 'Reload Page',
      section: 'Navigation',
      keywords: 'refresh',
      shortcut: hint('mod+r'),
      run: () => runMenuCommand('app:reload')
    },
    {
      id: 'force-reload',
      title: 'Reload (Ignore Cache)',
      section: 'Navigation',
      keywords: 'hard refresh',
      shortcut: hint('mod+shift+r'),
      run: () => runMenuCommand('app:force-reload')
    },
    {
      id: 'back',
      title: 'Go Back',
      section: 'Navigation',
      keywords: 'previous history',
      run: () => runMenuCommand('app:back')
    },
    {
      id: 'forward',
      title: 'Go Forward',
      section: 'Navigation',
      keywords: 'next history',
      run: () => runMenuCommand('app:forward')
    },
    {
      id: 'home',
      title: 'Go Home',
      section: 'Navigation',
      keywords: 'start page',
      run: () => runMenuCommand('app:home')
    },
    {
      id: 'find',
      title: 'Find in Page',
      section: 'Navigation',
      keywords: 'search text',
      shortcut: hint('mod+f'),
      run: () => runMenuCommand('app:find')
    },
    {
      id: 'print',
      title: 'Print…',
      section: 'Navigation',
      run: () => runMenuCommand('app:print')
    },

    // Dev Deck
    {
      id: 'toggle-deck',
      title: 'Toggle Dev Deck',
      section: 'Dev Deck',
      keywords: 'reveal hide workspace',
      shortcut: hint('mod+d'),
      run: () => toggleDeck()
    },
    {
      id: 'preset-browsing',
      title: 'Layout: Browsing',
      section: 'Dev Deck',
      keywords: 'preset arrangement',
      shortcut: hint('mod+1'),
      run: () => store().applyPreset('browsing')
    },
    {
      id: 'preset-building',
      title: 'Layout: Building',
      section: 'Dev Deck',
      keywords: 'preset arrangement',
      shortcut: hint('mod+2'),
      run: () => store().applyPreset('building')
    },
    {
      id: 'preset-debugging',
      title: 'Layout: Debugging',
      section: 'Dev Deck',
      keywords: 'preset arrangement',
      shortcut: hint('mod+3'),
      run: () => store().applyPreset('debugging')
    },
    {
      id: 'devtools',
      title: 'Open DevTools',
      section: 'Dev Deck',
      keywords: 'inspect console',
      run: () => runMenuCommand('app:devtools')
    },
    {
      id: 'utilities',
      title: 'Toggle Utilities Bar',
      section: 'Dev Deck',
      keywords: 'favourites canvas',
      run: () => runMenuCommand('app:utilities')
    },

    // Snapshots
    {
      id: 'save-snapshot',
      title: 'Save Session Snapshot',
      section: 'Snapshots',
      keywords: 'capture tabs layout workspace state',
      run: () => {
        const s = store()
        s.saveSnapshot('')
        s.pushToast('Session snapshot saved.', 'info')
      }
    },
    {
      id: 'restore-snapshot',
      title: 'Restore Snapshot…',
      section: 'Snapshots',
      keywords: 'reopen tabs layout session recall',
      run: () => store().setSnapshotsOpen(true)
    },
    {
      id: 'manage-snapshots',
      title: 'Manage Snapshots…',
      section: 'Snapshots',
      keywords: 'rename delete session panel',
      shortcut: hint('mod+shift+s'),
      run: () => store().setSnapshotsOpen(true)
    },

    // View
    {
      id: 'zoom-in',
      title: 'Zoom In',
      section: 'View',
      keywords: 'larger bigger',
      run: () => runMenuCommand('app:zoom-in')
    },
    {
      id: 'zoom-out',
      title: 'Zoom Out',
      section: 'View',
      keywords: 'smaller',
      run: () => runMenuCommand('app:zoom-out')
    },
    {
      id: 'zoom-reset',
      title: 'Actual Size',
      section: 'View',
      keywords: 'zoom reset 100%',
      run: () => runMenuCommand('app:zoom-reset')
    },
    {
      id: 'toggle-theme',
      title: 'Toggle Light / Dark Theme',
      section: 'View',
      keywords: 'appearance colour color mode',
      shortcut: hint('mod+shift+l'),
      run: () => store().setTheme(store().theme === 'dark' ? 'light' : 'dark')
    },

    // Application
    {
      id: 'settings',
      title: 'Open Settings',
      section: 'Application',
      keywords: 'preferences options config',
      run: () => runMenuCommand('app:settings')
    },
    {
      id: 'new-window',
      title: 'New Window',
      section: 'Application',
      run: () => runMenuCommand('app:new-window')
    },
    {
      id: 'new-incognito',
      title: 'New Incognito Tab',
      section: 'Application',
      keywords: 'private',
      run: () => runMenuCommand('app:new-incognito')
    },
    {
      id: 'save',
      title: 'Save',
      section: 'Application',
      keywords: 'write file',
      shortcut: hint('mod+s'),
      run: () => runMenuCommand('app:save')
    }
  ]
}

/**
 * Fuzzy subsequence match. Returns a score (higher is better) when every
 * character of `query` appears in order within `target`, or `null` when it
 * does not. An empty query matches everything with a neutral score, so the
 * caller keeps the source order. Shared by the palette and the tab switcher.
 */
export function fuzzyMatch(query: string, target: string): number | null {
  const q = query.trim().toLowerCase()
  const t = target.toLowerCase()
  if (q === '') return 0

  let score = 0
  let from = 0
  let prev = -2
  for (const ch of q) {
    const at = t.indexOf(ch, from)
    if (at === -1) return null
    // Consecutive characters read as a real substring — reward them.
    score += at === prev + 1 ? 3 : 1
    // Matches at a word boundary (start, or after a separator) count double.
    if (at === 0 || /[\s\-_/.:]/.test(t[at - 1])) score += 2
    prev = at
    from = at + 1
  }
  // Nudge shorter targets ahead when scores are otherwise close.
  return score - t.length * 0.01
}

export function useAppCommands(): void {
  useEffect(() => {
    const offs = MENU_COMMANDS.map((combo) =>
      registerShortcut({ combo, description: combo, handler: () => void runMenuCommand(combo) })
    )
    return () => offs.forEach((off) => off())
  }, [])
}
