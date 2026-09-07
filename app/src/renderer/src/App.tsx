import { useCallback, useEffect, useState } from 'react'
import { openSignedDocument } from '@/open-local-file'
import { TabStrip } from '@/components/TabStrip'
import { AssistantPanel } from '@/components/AssistantPanel'
import { AskButton } from '@/components/AskButton'
import { UtilitiesBar } from '@/components/UtilitiesBar'
import { Toolbar } from '@/components/Toolbar'
import { Stage } from '@/components/Stage'
import { Deck } from '@/components/Deck'
import { PermissionPrompts } from '@/components/PermissionPrompts'
import { SettingsOverlay } from '@/components/SettingsOverlay'
import { SnapshotPanel } from '@/components/SnapshotPanel'
import { CommandPalette } from '@/components/CommandPalette'
import { TabSwitcher } from '@/components/TabSwitcher'
import { ToastHost } from '@/components/ToastHost'
import { useShellStore, effectiveLeftWidth } from '@/store'
import { useThemeEffect } from '@/theme'
import { useShortcut } from '@/shortcuts'
import { runMenuCommand, useAppCommands } from '@/commands'
import { useWindowReconciler } from '@/windowSync'
import { installEditorAgentBridge } from '@/editor-agent-bridge'

export default function App(): React.JSX.Element {
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const deckMode = useShellStore((s) => s.deckMode)
  const deckSizes = useShellStore((s) => s.deckSizes)
  // An empty zone must not reserve space — a permanent empty band at the
  // bottom was the most obvious thing wrong with the first build.
  const groups = useShellStore((s) => s.groups)
  const dockEmpty = !groups.some((g) => g.zone === 'bottom')
  const leftEmpty = !groups.some((g) => g.zone === 'left')
  const hasRail = useShellStore((s) => s.rail.length > 0)
  const toggleDeck = useShellStore((s) => s.toggleDeck)
  const newTab = useShellStore((s) => s.newTab)
  const closeTab = useShellStore((s) => s.closeTab)
  const setTheme = useShellStore((s) => s.setTheme)
  const applyPreset = useShellStore((s) => s.applyPreset)

  // The ⌘K command palette and ⌘⇧A tab switcher are renderer overlays, so
  // their open state lives here beside the other shell-level surfaces.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // What the palette opens with: '' for ⌘K, '>' for ⌘⇧P (editor & extensions).
  const [paletteQuery, setPaletteQuery] = useState('')
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false)

  useThemeEffect()
  useWindowReconciler()

  // Answer the agent's editor_command / editor_list_commands requests from
  // VS Code's command registry (task 12.8) for as long as the shell is up.
  useEffect(() => installEditorAgentBridge(), [])

  // The core is the source of truth for the open workspace. The Files block's
  // own path field applies the reply it gets, but a project opened any other
  // way — a Recent entry, the agent, a synced setting, another window — only
  // announces itself through this event; without a subscriber the Deck kept
  // saying "No project open" while the core had already switched.
  useEffect(
    () =>
      window.agweb.onWorkspaceChanged((workspace) => {
        useShellStore.getState().setWorkspace(workspace)
      }),
    []
  )

  // The saved tab strip comes back once, at boot — it is the browser's, not a
  // project's, so a later project switch leaves the tabs alone.
  useEffect(() => {
    useShellStore.getState().restoreTabSession()
  }, [])

  // Load the active profile's bookmarks at boot (they are stored per profile).
  useEffect(() => {
    void window.agweb.profiles.list().then((state) => {
      useShellStore.getState().syncProfile(state.activeId)
    })
  }, [])

  // Route embedded-browser events into the store: live navigation state, and
  // pages requesting a new window become new browser tabs.
  useEffect(() => {
    const offState = window.agweb.browser.onState(useShellStore.getState().updateBrowserState)
    const offOpen = window.agweb.browser.onOpenTab((url) => {
      useShellStore.getState().newTab(url)
    })
    const offAdopt = window.agweb.browser.onAdoptTab((tabId, url) => {
      useShellStore.getState().adoptBrowserTab(tabId, url)
    })
    // Files dropped on the window. The browser has already opened anything it
    // renders itself, in its own tab; what arrives here is the documents only
    // WebDeck can read, as paths it signed.
    const offDropped = window.agweb.browser.onDocumentsDropped((files) => {
      for (const file of files) {
        void openSignedDocument(file).then((result) => {
          if (!result.ok) console.error('WebDeck: could not open a dropped file —', result.error)
        })
      }
    })
    // Shell-owned commands from the native menu / key equivalents that fired
    // while the PAGE had focus (the shortcut registry only sees keys when the
    // shell is focused). Same vocabulary as the menu: runMenuCommand.
    const offCommand = window.agweb.browser.onCommand((command) => {
      void runMenuCommand(command)
    })
    return () => {
      offDropped()
      offState()
      offOpen()
      offAdopt()
      offCommand()
    }
  }, [])

  // Surface denied agent actions as a toast, so a silently-blocked action isn't
  // invisible — especially an automatic policy deny with no prompt (P2-13).
  useEffect(() => {
    return window.agweb.policy.onDenied((info) => {
      const what =
        info.kind === 'file_write'
          ? 'file write'
          : info.kind === 'command'
            ? 'command'
            : 'navigation'
      useShellStore
        .getState()
        .pushToast(
          info.byUser
            ? `Denied the agent's ${what} — it was told.`
            : `Policy auto-denied the agent's ${what}.`,
          'warn'
        )
    })
  }, [])

  // A pull applied settings from another device — never silent, since one of the
  // synced sections is the agent's permission policy (the security gate).
  useEffect(() => {
    return window.agweb.sync.onPulled(() => {
      useShellStore.getState().pushToast('Settings updated from a synced device.', 'info')
    })
  }, [])

  useShortcut(
    'mod+d',
    'Reveal / hide the Dev Deck',
    useCallback(() => {
      if (useShellStore.getState().deckMode === 'detached') void window.agweb.windows.focusDeck()
      else toggleDeck()
    }, [toggleDeck])
  )
  useShortcut(
    'mod+t',
    'New browser tab',
    useCallback(() => newTab(), [newTab])
  )
  useShortcut(
    'mod+w',
    'Close active tab',
    useCallback(() => closeTab(useShellStore.getState().activeTabId), [closeTab])
  )
  useShortcut(
    'mod+shift+l',
    'Toggle light/dark theme',
    useCallback(() => {
      setTheme(useShellStore.getState().theme === 'dark' ? 'light' : 'dark')
    }, [setTheme])
  )
  // Layout presets — one keystroke swaps the whole Dev Deck arrangement (P3-7).
  useShortcut(
    'mod+1',
    'Layout preset: Browsing',
    useCallback(() => applyPreset('browsing'), [applyPreset])
  )
  useShortcut(
    'mod+2',
    'Layout preset: Building',
    useCallback(() => applyPreset('building'), [applyPreset])
  )
  useShortcut(
    'mod+3',
    'Layout preset: Debugging',
    useCallback(() => applyPreset('debugging'), [applyPreset])
  )
  // ⌘K opens the command palette; ⌘⇧A opens the tab switcher. Both ride the
  // same registry as the bindings above, so a key press or a menu accelerator
  // reaches them the same way.
  useShortcut(
    'mod+k',
    'Open the command palette',
    useCallback(() => {
      setPaletteQuery('')
      setPaletteOpen(true)
    }, [])
  )
  // ⌘⇧P is VS Code muscle memory: the same palette, opened scoped to editor &
  // extension commands via the ">" prefix (12.8) — one palette, not two.
  useShortcut(
    'mod+shift+p',
    'Editor & extension commands',
    useCallback(() => {
      setPaletteQuery('>')
      setPaletteOpen(true)
    }, [])
  )
  useShortcut(
    'mod+shift+a',
    'Switch tab',
    useCallback(() => setTabSwitcherOpen(true), [])
  )
  // ⌘⇧S opens Session Snapshots. Store-driven visibility (like Settings), so
  // the command palette can raise the same surface.
  useShortcut(
    'mod+shift+s',
    'Open session snapshots',
    useCallback(() => useShellStore.getState().setSnapshotsOpen(true), [])
  )

  // Commands the native menu sends. They ride the same registry as keyboard
  // combos — a menu item and its accelerator are then one handler, not two
  // implementations that can drift apart.
  useAppCommands()

  const revealed = deckRevealed && deckMode === 'attached'
  // Vertical tabs are a RAIL BLOCK docked to the stage's left edge (inside the
  // workspace, never in the title-bar row), and the toolbar moves up into the
  // title-bar row so the mode costs one row less. The stage and the Deck's left
  // column / dock shift right by --tabrail-w (styles.css) — nothing overlaps.
  const verticalTabs = useShellStore((s) => s.verticalTabs)
  const ownsChrome = window.agweb.host.ownsBrowserChrome
  const tabRail = verticalTabs && !ownsChrome
  const assistantOpen = useShellStore((s) => s.assistantOpen)
  const blockDragging = useShellStore((s) => s.blockDragging)

  return (
    // No file-drop handler here, and that is the whole design. A dropped file
    // is handled by the BROWSER, which is the only side that knows the path it
    // came from; the window offers it to us over Mojo and opens whatever we do
    // not claim. But the window only ever sees the drop if this page REFUSES
    // the drag: a page that calls preventDefault on dragover becomes the drop
    // target itself, the window is never asked, and a file dropped anywhere on
    // the shell does nothing at all. Refusing is how we receive it.
    <div className="wd-shell flex h-full flex-col">
      {/* Chrome is flush with the top of the window and shares its ground, so
          there is no seam between the app and its title bar. Tabs occupy the
          title-bar row itself, inline with the traffic lights. */}
      {/* Under the Chromium fork the page sits inside a real browser tab, so
          Chromium already draws the tab strip and address bar. Drawing ours too
          would stack a second, non-functional copy beneath the working one —
          and the user would reach for whichever is nearer the content. */}
      {!ownsChrome && (
        <div className="wd-chrome flex flex-none flex-col">
          {tabRail ? (
            <div
              className="drag-region flex items-center"
              data-testid="title-row"
              style={{ height: 'var(--wd-tabrow-h)', paddingLeft: 'var(--wd-titlebar-inset)' }}
            >
              <div className="min-w-0 flex-1">
                <Toolbar />
              </div>
              <AskButton />
            </div>
          ) : (
            <>
              {/* The strip scrolls when there are many tabs; Ask must not go
                  with it, so it sits outside the scroller, pinned right. */}
              <div className="flex min-w-0 items-center" data-testid="title-row">
                <div className="min-w-0 flex-1">
                  <TabStrip />
                </div>
                <AskButton />
              </div>
              <Toolbar />
            </>
          )}
        </div>
      )}
      {!window.agweb.host.ownsBrowserChrome && <UtilitiesBar />}
      <PermissionPrompts />
      <SettingsOverlay />
      <SnapshotPanel />
      <CommandPalette
        open={paletteOpen}
        initialQuery={paletteQuery}
        onClose={() => setPaletteOpen(false)}
        onOpenTabSwitcher={() => {
          setPaletteOpen(false)
          setTabSwitcherOpen(true)
        }}
      />
      <TabSwitcher open={tabSwitcherOpen} onClose={() => setTabSwitcherOpen(false)} />
      <ToastHost />
      <div
        className={`workspace ${revealed ? 'revealed' : ''} ${hasRail ? 'has-rail' : ''} ${
          dockEmpty ? 'dock-empty' : ''
        } ${leftEmpty ? 'left-empty' : ''} ${tabRail ? 'has-tabrail' : ''} ${
          deckSizes.corners?.left === 'column' ? 'left-corner-column' : ''
        } ${deckSizes.corners?.right === 'column' ? 'right-corner-column' : ''} ${
          assistantOpen ? 'has-assistant' : ''
        } ${blockDragging ? 'dragging-block' : ''}`}
        style={
          {
            '--deck-col-w': `${deckSizes.colWidth}px`,
            // Computed here, not in CSS: these are inline custom properties, so
            // a `.dock-empty` class rule would lose to them on specificity and
            // the stage would keep reserving space for a dock that isn't there.
            '--deck-left-w': `${leftEmpty ? 0 : effectiveLeftWidth(deckSizes)}px`,
            // -12px cancels the 12px gutter, so an empty dock costs nothing.
            '--deck-dock-h': `${dockEmpty ? -12 : deckSizes.dockHeight}px`
          } as React.CSSProperties
        }
      >
        {tabRail && <TabStrip />}
        <Stage />
        {assistantOpen && <AssistantPanel />}
        {deckMode === 'attached' && <Deck />}
        <ViewportChip />
      </div>
    </div>
  )
}

/**
 * The viewport chip (P3-4): a small ambient label that fades in on the spotlit
 * stage once it lands, naming what you're building around — "localhost:5173 ·
 * inspecting". Visibility and the land-timed fade are driven by the `.revealed`
 * parent in CSS; this only supplies the label for the active tab.
 */
function ViewportChip(): React.JSX.Element | null {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const url = useShellStore((s) => s.browserStates[s.activeTabId]?.url)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === activeTabId))

  let label = ''
  let state = 'inspecting'
  if (activeTab?.kind === 'doc') {
    label = (activeTab.docPath ?? '').split('/').pop() ?? 'document'
    state = 'reading'
  } else if (url) {
    try {
      label = new URL(url).host
    } catch {
      label = ''
    }
  }
  if (!label) return null

  return (
    <div className="viewport-chip" aria-hidden="true">
      <span className="truncate">{label}</span>
      <span className="viewport-chip-sep">·</span>
      <span className="viewport-chip-state">{state}</span>
    </div>
  )
}
