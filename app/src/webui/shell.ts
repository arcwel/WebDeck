import { IpcChannels, IpcEvents } from '@shared/ipc'
import type {
  BrowserAccountInfo,
  BrowserTabState,
  ExtensionActionInfo,
  Rect,
  SettingPref
} from '@shared/ipc'

/**
 * The WebDeck window's half of driving its own tabs.
 *
 * When WebDeck owns the window (no native Chrome chrome), the shell draws its
 * glass tab strip, toolbar and Stage, and drives the real tab in the window over
 * the `Shell` Mojo interface — open/navigate/back/forward/reload, and the
 * signature move: streaming the "stage" rect the active tab is sized to
 * (`setStageBounds`, the same contents-resizing strategy docked DevTools uses).
 *
 *     shell UI → window.agweb.browser.* → [Mojo Shell] → browser → the tab
 *
 * The shell owns tab identity as its own string ids and, for now, drives the
 * single staged (active) tab: `browser.*` calls are mapped onto the active tab
 * (`ACTIVE`). Split view and multi-tab switching build on this same interface.
 *
 * Mojo exists only inside the fork; on any other host these calls fail with a
 * clear reason rather than pretending to have worked.
 */

/** The subset of the generated Mojo remote this module uses. */
interface ShellRemote {
  setStageBounds(stage: { x: number; y: number; width: number; height: number }): void
  setStageVisible(visible: boolean): void
  // A still of the staged tab (data: URL, '' when nothing could be copied).
  captureStage(tabId: number): Promise<{ dataUrl: string }>
  openWindow(url: string): Promise<{ windowId: number }>
  focusWindow(windowId: number): void
  closeWindow(windowId: number): void
  pickPaths(mode: number): Promise<{ paths: string[] }>
  createTab(url: string): Promise<{ tabId: number }>
  selectTab(tabId: number): void
  closeTab(tabId: number): void
  navigate(tabId: number, url: string): void
  reload(tabId: number): void
  goBack(tabId: number): void
  goForward(tabId: number): void
  stop(tabId: number): void
  setStageCornerRadius(radius: number): void
  // Split view (see SPLIT_VIEW_PLAN.md). setSplit binds the two staged tabs
  // (tab_id 0 = active); setSecondaryStageBounds positions the secondary (right)
  // stage, mirroring setStageBounds for the primary. Snake_case mojom params
  // become camelCase in the generated remote (primary_tab_id -> primaryTabId).
  setSplit(enabled: boolean, primaryTabId: number, secondaryTabId: number): void
  setSecondaryStageBounds(stage: { x: number; y: number; width: number; height: number }): void
  // Toggle Picture-in-Picture for the tab.
  togglePictureInPicture(tabId: number): void
  // Read the tab's rendered visible text (document.body.innerText, capped
  // browser-side). tab_id 0 = active tab. Resolves to an object with the text.
  getPageText(tabId: number): Promise<{ text: string }>
  // The extensions pinned in chrome://extensions, for the toolbar the shell
  // draws, and the click that runs one. `popupUrl` is empty unless the
  // extension wants a popup shown.
  getExtensionActions(tabId: number): Promise<{ actions: ExtensionActionInfo[] }>
  runExtensionAction(tabId: number, extensionId: string): Promise<{ showedPopup: boolean }>
  // Chromium's own settings, by preference name. The browser refuses any name
  // that is not on its allowlist.
  getSettingPrefs(names: string[]): Promise<{ prefs: SettingPref[] }>
  setSettingPref(name: string, jsonValue: string): Promise<{ ok: boolean }>
  // Who is signed in, for the profile button.
  getAccountInfo(): Promise<{ info: BrowserAccountInfo }>
  // Open a local file in a tab — the browser picks the path, never the page.
  openLocalFile(tabId: number): Promise<{
    result: { navigated: boolean; document: { path: string; auth: string } | null }
  }>
  find(tabId: number, query: string, forward: boolean): void
  stopFind(tabId: number): void
  setZoom(tabId: number, level: number): Promise<{ applied: number }>
  print(tabId: number): void
  openDevTools(tabId: number): void
  // Browser-level preferences (see BrowserSettings.tsx). Mojo getters resolve to
  // an object of the response fields; setters are fire-and-forget (void).
  getBlockThirdPartyCookies(): Promise<{ blocked: boolean }>
  setBlockThirdPartyCookies(blocked: boolean): void
  getSendDoNotTrack(): Promise<{ enabled: boolean }>
  setSendDoNotTrack(enabled: boolean): void
  getHttpsOnlyMode(): Promise<{ enabled: boolean }>
  setHttpsOnlyMode(enabled: boolean): void
  getPreloadPages(): Promise<{ enabled: boolean }>
  setPreloadPages(enabled: boolean): void
  getAdblockEnabled(): Promise<{ enabled: boolean }>
  setAdblockEnabled(enabled: boolean): void
  // mojo uint64 arrives as a bigint in the generated JS bindings.
  getAdblockBlockedCount(): Promise<{ count: bigint }>
  clearBrowsingData(
    cookies: boolean,
    cache: boolean,
    history: boolean,
    timeRange: number
  ): Promise<unknown>
  getDefaultBrowserState(): Promise<{ state: number }>
  setAsDefaultBrowser(): Promise<{ state: number }>
  setClient(client: unknown): void
}

/** tab_id 0 addresses the active (staged) tab — see WebDeckShell::GetTabById. */
const ACTIVE = 0

/**
 * The shell owns tab identity as its own string ids; the browser owns tabs by a
 * numeric TabHandle. These map between them: `browser.create` records the handle
 * CreateTab returns, and every other `browser.*` call resolves the shell id to
 * its handle. An unmapped id falls back to the active tab (`ACTIVE`).
 */
const handleByShellId = new Map<string, number>()
const shellIdByHandle = new Map<number, string>()
/** Last zoom level applied per shell tab, so a level-less zoom() can read it. */
const zoomByShellId = new Map<string, number>()

/**
 * One tab in the browser's set, mirrored from the mojom `TabInfo` struct
 * (`ShellClient.OnTabsChanged` / `OnTabNavigationStateChanged`). Snake_case
 * mojom fields become camelCase in the generated webui bindings — `tab_id`
 * becomes `tabId`, `can_go_back` becomes `canGoBack`, and so on.
 */
interface TabInfo {
  tabId: number
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

/**
 * Shell ids the browser minted the tab for, not the shell. Link-adopted tabs
 * (window.open / target=_blank) have no shell id yet, so onTabsChanged coins one
 * from a namespace distinct from the store's own `tab-N` ids to avoid collisions.
 */
let nextAdoptedTabId = 1
function mintAdoptedShellId(): string {
  return `adopted-tab-${nextAdoptedTabId++}`
}

function mapTab(shellId: string, handle: number): void {
  handleByShellId.set(shellId, handle)
  shellIdByHandle.set(handle, shellId)
}
function unmapTab(shellId: string): void {
  const handle = handleByShellId.get(shellId)
  handleByShellId.delete(shellId)
  if (handle !== undefined) shellIdByHandle.delete(handle)
  // The browser never closes its last real tab (WebDeckShell::CloseTab empties
  // it instead), so a destroyed seed is blank and unowned again: claimable.
  if (handle !== undefined && handle === seedHandle) seedClaimed = false
}
function handleFor(shellId: unknown): number {
  return handleByShellId.get(String(shellId)) ?? ACTIVE
}

/**
 * Shell ids with a `browser.create` in flight, oldest first.
 *
 * `Shell.createTab` foregrounds the new tab, which makes the browser fire
 * `onTabsChanged` (over the separate ShellClient pipe) with the new handle
 * BEFORE createTab's own reply lands — so without this the handler would mint a
 * phantom `adopted-tab-N`, add a second tab to the strip, and steal activeTabId
 * from the tab the user is navigating (the "navigated page never shows" bug).
 * When a create is pending, onTabsChanged binds the first new handle to that
 * shell id instead of adopting it. FIFO because concurrent creates are all
 * about:blank staged tabs — the exact pairing does not matter, only that no
 * phantom is coined and focus is not stolen.
 */
const pendingCreates: string[] = []

/**
 * The window's SEED tab: the one real tab Chromium opens every window with
 * (about:blank, staged behind the start page). The shell did not create it, so
 * without this it would be adopted as a phantom "about:blank" tab — and, being
 * the browser's active tab, it would take the stage and black out the start
 * page. It is recognised on the first snapshot (no mappings yet, no create in
 * flight, url about:blank), never adopted, and CLAIMED by the shell's first
 * `browser.create` instead of opening a second real tab: the window keeps one
 * real tab per shell tab, and the seed is never left over.
 */
let seedHandle: number | null = null
let seedClaimed = false

/**
 * The shell tab id the browser's active-tab state is attributed to.
 *
 * The browser drives a single staged (active) tab and reports its state without
 * knowing the shell's own string ids. The Stage streams `browser.setBounds`
 * with the active shell tab id every frame, so we capture it there and stamp it
 * onto the state pushed back — so the shell's tab strip / address bar update the
 * right tab.
 */
let currentStageTabId = ''
// Windows this shell opened for the Deck (#deck) and floating groups (#float:id),
// by the browser's window id, so they can be focused and closed again.
let deckWindowId = 0
const floatWindowIds = new Map<string, number>()
async function openShellWindow(hash: string): Promise<number> {
  const { windowId } = await (await getShell()).openWindow(`chrome://webdeck/#${hash}`)
  return windowId
}

/** Browser event channels the Mojo ShellClient delivers (not the core). */
export const SHELL_BROWSER_EVENTS: ReadonlySet<string> = new Set([
  IpcEvents.browserState,
  IpcEvents.browserFindResult,
  // Emitted by onTabsChanged when the browser opened a tab the shell did not
  // (window.open / target=_blank / ctrl-click) — the store adopts it.
  IpcEvents.browserAdoptTab,
  // A shell-owned command from the native menu / a key equivalent that fired
  // while the page had focus (ShellClient.OnCommand).
  IpcEvents.browserCommand,
  // Documents dropped on the window (ShellClient.OnDocumentsDropped).
  //
  // Every channel the ShellClient below emits MUST be in this set. The adapter
  // uses it to decide where a subscriber's listener goes: a channel named here
  // is wired to the shell's local bus, and any other channel is wired to the
  // core's socket instead. A ShellClient method that emits on a channel missing
  // from this set is shouting into an empty room — the browser reports success,
  // the page never hears it, and nothing on screen says why. That is exactly
  // how dropped files reached the shell and then vanished. shell.test.ts now
  // checks the two lists against each other.
  IpcEvents.browserDocumentsDropped
])

const browserEventListeners = new Map<string, Set<(payload: unknown) => void>>()

/**
 * Subscribe to a browser event pushed by the Mojo ShellClient. The adapter
 * routes browser event channels here instead of to the core (the browser, not
 * the core, owns tab state). Binding the first listener lazily registers the
 * ShellClient with the browser so it starts pushing.
 */
export function onShellBrowserEvent(
  channel: string,
  listener: (payload: unknown) => void
): () => void {
  let set = browserEventListeners.get(channel)
  if (!set) {
    set = new Set()
    browserEventListeners.set(channel, set)
  }
  set.add(listener)
  void ensureShellClient()
  return () => {
    set?.delete(listener)
  }
}

function emitShellBrowserEvent(channel: string, payload: unknown): void {
  for (const listener of browserEventListeners.get(channel) ?? []) {
    listener(payload)
  }
}

/** The subset of the generated ShellClient receiver this module constructs. */
interface ShellClientReceiver {
  $: { bindNewPipeAndPassRemote(): unknown }
}

let shellClientPromise: Promise<void> | null = null

/**
 * Resolved once the browser has pushed its first tab set (SetClient triggers
 * that push). Callers that must know the window's existing tabs before acting
 * wait on it — see `browserCreate` and the seed tab.
 */
let markFirstTabSnapshot: (() => void) | null = null
const firstTabSnapshot = new Promise<void>((resolve) => {
  markFirstTabSnapshot = resolve
})

/** How long a caller waits for that first push before giving up on it. Off the
 *  fork nothing ever pushes, and the shell must not stall on a browser that is
 *  not there. */
const FIRST_SNAPSHOT_TIMEOUT_MS = 1500

/**
 * Register a ShellClient with the browser so it pushes navigation state back
 * (url/title/back-forward/loading). Bound once. If Mojo is unavailable the shell
 * simply gets no live state — the address bar still reflects what the user
 * typed — rather than throwing.
 *
 * Resolves only once the browser's first tab set has been processed, so a
 * caller that awaits this knows what tabs the window already has.
 */
function ensureShellClient(): Promise<void> {
  if (!shellClientPromise) shellClientPromise = bindShellClient()
  return shellClientPromise
}

async function bindShellClient(): Promise<void> {
  try {
    const shell = await getShell()
    const mod = (await import(/* @vite-ignore */ BINDINGS_URL)) as {
      ShellClientReceiver: new (impl: {
        onTabsChanged(tabs: TabInfo[], activeTabId: number): void
        onTabNavigationStateChanged(info: {
          tabId: number
          url: string
          title: string
          canGoBack: boolean
          canGoForward: boolean
          isLoading: boolean
        }): void
        onTabClosed(tabId: number): void
        onFindResult(tabId: number, activeMatch: number, totalMatches: number): void
        onCommand(command: string): void
        onDocumentsDropped(files: { path: string; auth: string }[]): void
      }) => ShellClientReceiver
    }
    const receiver = new mod.ShellClientReceiver({
      // Reconcile the browser's tab set into the shell store. The browser owns
      // tabs by numeric TabHandle and reports the full set on every change; any
      // handle we have no shell id for is a tab a page opened itself (window.open
      // / target=_blank / ctrl-click). Coin a shell id, record the mapping, and
      // emit an adopt event so the store adds it to the strip.
      onTabsChanged(tabs) {
        const seen = new Set<number>()
        for (const tab of tabs) {
          seen.add(tab.tabId)
          if (shellIdByHandle.has(tab.tabId)) continue
          if (tab.tabId === seedHandle) continue
          // A shell-initiated create is waiting for exactly this new handle:
          // bind it to that shell id rather than coining a phantom adopted tab
          // and stealing focus. See `pendingCreates`.
          const pending = pendingCreates.shift()
          if (pending !== undefined) {
            mapTab(pending, tab.tabId)
            continue
          }
          // The window's seed tab (see `seedHandle`): not adopted, claimed later.
          if (seedHandle === null && handleByShellId.size === 0 && tab.url === 'about:blank') {
            seedHandle = tab.tabId
            continue
          }
          const shellId = mintAdoptedShellId()
          mapTab(shellId, tab.tabId)
          emitShellBrowserEvent(IpcEvents.browserAdoptTab, {
            tabId: shellId,
            url: tab.url,
            title: tab.title
          })
        }
        // Defensive: drop mappings for handles no longer in the set. onTabClosed
        // is the primary path; this catches a close that arrives only as a
        // snapshot without its own OnTabClosed.
        for (const handle of [...shellIdByHandle.keys()]) {
          if (seen.has(handle)) continue
          const shellId = shellIdByHandle.get(handle)
          if (shellId !== undefined) unmapTab(shellId)
        }
        if (seedHandle !== null && !seen.has(seedHandle)) seedHandle = null
        // The window's tab set is now known; anyone waiting to act on it can go.
        markFirstTabSnapshot?.()
        markFirstTabSnapshot = null
      },
      onTabNavigationStateChanged(info) {
        const state: BrowserTabState = {
          // Attribute to the shell tab that owns this handle; fall back to the
          // staged tab id captured from setBounds.
          tabId: shellIdByHandle.get(info.tabId) ?? currentStageTabId,
          url: info.url,
          title: info.title,
          isLoading: info.isLoading,
          canGoBack: info.canGoBack,
          canGoForward: info.canGoForward
        }
        emitShellBrowserEvent(IpcEvents.browserState, state)
      },
      onTabClosed(tabId) {
        const shellId = shellIdByHandle.get(tabId)
        if (shellId !== undefined) unmapTab(shellId)
        if (tabId === seedHandle) seedHandle = null
      },
      onFindResult(tabId, activeMatch, totalMatches) {
        emitShellBrowserEvent(IpcEvents.browserFindResult, {
          tabId: shellIdByHandle.get(tabId) ?? currentStageTabId,
          matches: totalMatches,
          active: activeMatch
        })
      },
      // The browser names the command ("new-tab"); the renderer's vocabulary
      // is `app:<name>` (commands.ts runMenuCommand).
      onCommand(command) {
        emitShellBrowserEvent(IpcEvents.browserCommand, `app:${command}`)
      },
      // Documents dropped on the window. The browser has already opened
      // anything it can render itself; these are the ones only WebDeck reads.
      onDocumentsDropped(files) {
        emitShellBrowserEvent(IpcEvents.browserDocumentsDropped, files)
      }
    })
    shell.setClient(receiver.$.bindNewPipeAndPassRemote())
    // SetClient makes the browser push its tab list. Wait for it, so a caller
    // learns the window's seed tab before deciding to open another one.
    //
    // Losing this race is not fatal but it is not free either: the seed tab
    // goes unrecognised, a second real tab is opened, and the seed comes back
    // as a phantom "about:blank". That degradation is invisible from the
    // outside, so say it out loud rather than leaving someone to rediscover it.
    const timedOut = await Promise.race([
      firstTabSnapshot.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), FIRST_SNAPSHOT_TIMEOUT_MS))
    ])
    if (timedOut) {
      console.warn(
        `WebDeck shell: the browser did not push its tab list within ${FIRST_SNAPSHOT_TIMEOUT_MS}ms; ` +
          'a blank tab may appear beside the first one.'
      )
    }
  } catch (err) {
    // No live browser state on a non-fork host; leave clientBound set so we do
    // not retry a failure the user cannot act on. Off-fork the reason is the
    // documented "cannot reach the browser"; ON the fork any failure here means
    // the address bar and tab titles will never update, so say so loudly.
    if (!unavailable) {
      console.error('WebDeck shell: could not register the ShellClient —', err)
    }
  }
}

/** Where the transpiled Mojo bindings are served from (see agent-tabs.ts).
 *  ABSOLUTE ("/mojo/…"): this module is bundled under assets/, so a relative
 *  "./mojo/…" would resolve to chrome://webdeck/assets/mojo/… and 404 — the
 *  file is served at the WebUI root, chrome://webdeck/mojo/…. */
const BINDINGS_URL = '/mojo/webdeck.mojom-webui.js'

let remote: ShellRemote | null = null
let unavailable: string | null = null

/**
 * The in-flight resolution of the remote, shared by every concurrent caller.
 *
 * ONE pipe, ever. `Shell.getRemote()` opens a fresh Mojo pipe on every call and
 * the browser keeps a single WebDeckShell per page — binding a second remote
 * REPLACES the first and closes its pipe. Before this was memoised, the client
 * registration (ensureShellClient, at mount) and the first `browser.create`
 * (Stage) both found `remote` unset, both imported the bindings, both bound a
 * pipe: the browser dropped the first, `setClient` on it threw "pipe has
 * already been closed" inside a swallowed catch, and the shell never received
 * a single navigation event — commands worked, the address bar and tab titles
 * stayed blank forever.
 */
let remotePromise: Promise<ShellRemote> | null = null

function getShell(): Promise<ShellRemote> {
  if (remote) return Promise.resolve(remote)
  if (unavailable) return Promise.reject(new Error(unavailable))
  if (remotePromise) return remotePromise
  remotePromise = (async () => {
    try {
      const mod = (await import(/* @vite-ignore */ BINDINGS_URL)) as {
        Shell: { getRemote(): ShellRemote }
      }
      remote = mod.Shell.getRemote()
      return remote
    } catch (err) {
      unavailable =
        'the WebDeck shell cannot reach the browser on this host — driving the ' +
        `window needs the Arcwel WebDeck build (${(err as Error).message})`
      throw new Error(unavailable, { cause: err })
    } finally {
      remotePromise = null
    }
  })()
  return remotePromise
}

/**
 * Normalise an incoming rect: round every field to a whole pixel, clamp width
 * and height to be non-negative, and treat a missing/garbage value as 0. The
 * Stage streams this from a ResizeObserver, so it must never hand the browser a
 * fractional or negative size. Exported for unit testing.
 */
export function toRect(value: unknown): { x: number; y: number; width: number; height: number } {
  const r = (value ?? {}) as Partial<Rect>
  return {
    x: Math.round(Number(r.x) || 0),
    y: Math.round(Number(r.y) || 0),
    width: Math.max(0, Math.round(Number(r.width) || 0)),
    height: Math.max(0, Math.round(Number(r.height) || 0))
  }
}

/**
 * The `browser.*` channels the WebDeck window answers over the Mojo Shell,
 * mapped onto the single staged (active) tab.
 *
 * Deliberately a KNOWN list — an unknown browser channel still falls through and
 * rejects loudly, because that means a real wiring bug. The secondary channels
 * are benign no-ops here (documented inline); they gain real behaviour as the
 * Shell interface grows (split view, per-tab visibility, corner radius, find,
 * zoom, print, devtools).
 */
export const SHELL_BROWSER: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  // Open a real tab and remember the shell id -> handle mapping.
  [IpcChannels.browserCreate]: async (shellId) => {
    const id = String(shellId)
    // Learn the window's tabs FIRST. A create issued before the browser's
    // first push — which is what a restored session does, because it opens a
    // page the moment the strip is rebuilt — used to miss the seed tab, open a
    // second real tab, and leave the seed to be adopted as a phantom
    // "about:blank". That is the blank tab that came back on every restore.
    await ensureShellClient()
    // The first shell tab to need a real tab takes the window's seed tab
    // (already open, already active) instead of opening a second one.
    if (seedHandle !== null && !seedClaimed) {
      seedClaimed = true
      mapTab(id, seedHandle)
      return
    }
    // Register BEFORE createTab so the onTabsChanged that createTab triggers
    // (which arrives first, on the ShellClient pipe) binds the new handle to
    // this id instead of adopting a phantom. See `pendingCreates`.
    pendingCreates.push(id)
    try {
      const { tabId } = await (await getShell()).createTab('about:blank')
      // Usually onTabsChanged already bound the handle to `id`. If it did not
      // (its event lost or reordered), bind the returned handle now.
      if (!handleByShellId.has(id)) {
        // createTab returns 0 on failure (disallowed URL / null WebContents).
        // 0 is also the "active tab" sentinel, so mapping it would silently
        // alias this tab onto whatever is active — surface a failure instead.
        if (!tabId) throw new Error('Shell.createTab failed (no tab handle)')
        mapTab(id, tabId)
      }
    } finally {
      const i = pendingCreates.indexOf(id)
      if (i !== -1) pendingCreates.splice(i, 1)
    }
  },
  // Closing the shell's tab closes the real one; drop the mapping.
  [IpcChannels.browserDestroy]: async (shellId) => {
    ;(await getShell()).closeTab(handleFor(shellId))
    unmapTab(String(shellId))
  },
  [IpcChannels.browserNavigate]: async (shellId, url) => {
    ;(await getShell()).navigate(handleFor(shellId), String(url))
  },
  [IpcChannels.browserBack]: async (shellId) => {
    ;(await getShell()).goBack(handleFor(shellId))
  },
  [IpcChannels.browserForward]: async (shellId) => {
    ;(await getShell()).goForward(handleFor(shellId))
  },
  [IpcChannels.browserReload]: async (shellId) => {
    ;(await getShell()).reload(handleFor(shellId))
  },
  [IpcChannels.browserStop]: async (shellId) => {
    ;(await getShell()).stop(handleFor(shellId))
  },
  // The stage's visibility follows the shell's overlays: hidden while a menu,
  // the palette or Settings is open (the native tab would paint over them),
  // shown again — and activated — when they close.
  [IpcChannels.browserSetVisible]: async (shellId, visible) => {
    const shell = await getShell()
    if (visible) shell.selectTab(handleFor(shellId))
    shell.setStageVisible(Boolean(visible))
  },
  // The still the stage shows while it is hidden: the page keeps its content
  // behind a menu instead of going blank.
  [IpcChannels.browserCaptureStage]: async (shellId) =>
    (await getShell()).captureStage(handleFor(shellId)).then((r) => r.dataUrl),
  // The native open panel, which reports real paths (Shell.PickPaths). Only a
  // privileged shell page may learn where a file lives; the core then opens the
  // project / reads the attachment by that path, exactly as Electron's did.
  [IpcChannels.dialogPickPaths]: async (mode) => {
    const code = mode === 'dir' ? 1 : mode === 'image' ? 2 : 0
    const { paths } = await (await getShell()).pickPaths(code)
    return paths
  },
  // Windows: the Deck detached into its own window, floating stacks, a second
  // full shell. Each is a real browser window whose shell page carries the role.
  [IpcChannels.windowNew]: async () => (await openShellWindow('')) !== 0,
  [IpcChannels.deckOpen]: async () => {
    if (deckWindowId) (await getShell()).focusWindow(deckWindowId)
    else deckWindowId = await openShellWindow('deck')
  },
  [IpcChannels.deckClose]: async () => {
    if (!deckWindowId) return
    const id = deckWindowId
    deckWindowId = 0
    ;(await getShell()).closeWindow(id)
  },
  [IpcChannels.deckFocus]: async () => {
    if (deckWindowId) (await getShell()).focusWindow(deckWindowId)
  },
  [IpcChannels.floatSync]: async (groupIds) => {
    const wanted = new Set(Array.isArray(groupIds) ? groupIds.map(String) : [])
    const shell = await getShell()
    for (const [groupId, id] of [...floatWindowIds]) {
      if (!wanted.has(groupId)) {
        floatWindowIds.delete(groupId)
        shell.closeWindow(id)
      }
    }
    for (const groupId of wanted) {
      if (!floatWindowIds.has(groupId)) {
        const id = await openShellWindow(`float:${groupId}`)
        if (id) floatWindowIds.set(groupId, id)
      }
    }
  },
  // The signature call: the Stage's ResizeObserver streams the stage rect here.
  [IpcChannels.browserSetBounds]: async (shellId, rect) => {
    currentStageTabId = String(shellId)
    ;(await getShell()).setStageBounds(toRect(rect))
  },
  // The Stage-reveal rounded frame (0 = square).
  [IpcChannels.browserSetCornerRadius]: async (_shellId, radius) => {
    ;(await getShell()).setStageCornerRadius(Math.max(0, Math.round(Number(radius) || 0)))
  },
  [IpcChannels.browserDevTools]: async (shellId) => {
    ;(await getShell()).openDevTools(handleFor(shellId))
  },
  [IpcChannels.browserFind]: async (shellId, query, next) => {
    ;(await getShell()).find(handleFor(shellId), String(query), Boolean(next))
  },
  [IpcChannels.browserFindStop]: async (shellId) => {
    ;(await getShell()).stopFind(handleFor(shellId))
  },
  // zoom(id) reads the last applied level; zoom(id, level) sets and returns it.
  [IpcChannels.browserZoom]: async (shellId, level) => {
    if (level === undefined || level === null) return zoomByShellId.get(String(shellId)) ?? 0
    const { applied } = await (await getShell()).setZoom(handleFor(shellId), Number(level))
    zoomByShellId.set(String(shellId), applied)
    return applied
  },
  [IpcChannels.browserPrint]: async (shellId) => {
    ;(await getShell()).print(handleFor(shellId))
    return true
  },
  // Split view: bind the two staged tabs. Shell ids map to TabHandles the same
  // way every other tab op does; an unmapped id falls back to the active tab.
  // On disable the browser ignores the secondary id, so passing ACTIVE is fine.
  [IpcChannels.browserSetSplit]: async (enabled, primaryShellId, secondaryShellId) => {
    ;(await getShell()).setSplit(
      Boolean(enabled),
      handleFor(primaryShellId),
      handleFor(secondaryShellId)
    )
  },
  // Position the secondary (right) stage — same rounding/clamping as setBounds.
  [IpcChannels.browserSetSecondaryBounds]: async (rect) => {
    ;(await getShell()).setSecondaryStageBounds(toRect(rect))
  },
  // Toggle Picture-in-Picture for the tab.
  [IpcChannels.browserPictureInPicture]: async (shellId) => {
    ;(await getShell()).togglePictureInPicture(handleFor(shellId))
  },
  // Read the staged tab's visible text for the Page Assistant (roadmap A4).
  // Unwrap the Mojo response object to the bare string; an unmapped id (e.g. 0)
  // falls back to the active tab, the same as every other tab op.
  [IpcChannels.browserGetPageText]: async (shellId) =>
    (await getShell()).getPageText(handleFor(shellId)).then((r) => r.text),
  // Pinned extensions. The browser answers for the tab the user is looking at,
  // because an extension's title, badge and enabled state are all per-page.
  [IpcChannels.extensionsActions]: async (shellId) =>
    (await getShell()).getExtensionActions(handleFor(shellId)).then((r) => r.actions),
  [IpcChannels.extensionsRunAction]: async (shellId, extensionId) =>
    (await getShell())
      .runExtensionAction(handleFor(shellId), String(extensionId))
      .then((r) => r.showedPopup),
  [IpcChannels.profilesAccount]: async () =>
    (await getShell()).getAccountInfo().then((r) => r.info),
  // Local files. Chromium's own viewers render them — its PDF viewer, with
  // annotation, for a PDF.
  // A document comes back as a SIGNED PATH rather than a navigation: Chromium
  // has no reader for one, so the shell opens it in Document Studio, at the
  // path the file actually lives at.
  [IpcChannels.browserOpenLocalFile]: async (shellId) =>
    (await getShell())
      .openLocalFile(handleFor(shellId))
      .then((r) => ({ navigated: r.result.navigated, document: r.result.document ?? null })),
  // Chromium's settings. The renderer names prefs; the browser decides which
  // it will answer for.
  [IpcChannels.browserGetSettingPrefs]: async (names) =>
    (await getShell())
      .getSettingPrefs(Array.isArray(names) ? (names as string[]).map(String) : [])
      .then((r) => r.prefs),
  [IpcChannels.browserSetSettingPref]: async (name, jsonValue) =>
    (await getShell()).setSettingPref(String(name), String(jsonValue)).then((r) => r.ok),
  // --- browser-level preferences. These are window/profile-wide (not per-tab),
  // so they take no shell id; the browser reads/writes the shell's own Profile.
  [IpcChannels.browserGetCookieBlock]: async () =>
    (await getShell()).getBlockThirdPartyCookies().then((r) => r.blocked),
  [IpcChannels.browserSetCookieBlock]: async (blocked) => {
    ;(await getShell()).setBlockThirdPartyCookies(Boolean(blocked))
  },
  [IpcChannels.browserGetDnt]: async () =>
    (await getShell()).getSendDoNotTrack().then((r) => r.enabled),
  [IpcChannels.browserSetDnt]: async (enabled) => {
    ;(await getShell()).setSendDoNotTrack(Boolean(enabled))
  },
  [IpcChannels.browserGetHttpsOnly]: async () =>
    (await getShell()).getHttpsOnlyMode().then((r) => r.enabled),
  [IpcChannels.browserSetHttpsOnly]: async (enabled) => {
    ;(await getShell()).setHttpsOnlyMode(Boolean(enabled))
  },
  [IpcChannels.browserGetPreload]: async () =>
    (await getShell()).getPreloadPages().then((r) => r.enabled),
  [IpcChannels.browserSetPreload]: async (enabled) => {
    ;(await getShell()).setPreloadPages(Boolean(enabled))
  },
  [IpcChannels.browserGetAdblock]: async () =>
    (await getShell()).getAdblockEnabled().then((r) => r.enabled),
  [IpcChannels.browserSetAdblock]: async (enabled) => {
    ;(await getShell()).setAdblockEnabled(Boolean(enabled))
  },
  // uint64 arrives as a bigint; the panel wants a plain number for formatting.
  [IpcChannels.browserGetAdblockCount]: async () =>
    (await getShell()).getAdblockBlockedCount().then((r) => Number(r.count)),
  [IpcChannels.browserClearData]: async (cookies, cache, history, timeRange) => {
    await (
      await getShell()
    ).clearBrowsingData(Boolean(cookies), Boolean(cache), Boolean(history), Number(timeRange) || 0)
  },
  [IpcChannels.browserDefaultStatus]: async () =>
    (await getShell()).getDefaultBrowserState().then((r) => r.state),
  [IpcChannels.browserMakeDefault]: async () =>
    (await getShell()).setAsDefaultBrowser().then((r) => r.state)
}

/**
 * Default-browser status codes returned by the browser (see WebDeckShell
 * DefaultBrowserStateCode): not default, default, or unknown/error.
 */
export type BrowserDefaultState = 0 | 1 | 2

/**
 * The typed browser-preferences API the Browser settings panel imports.
 *
 * A thin facade over the `SHELL_BROWSER` handlers above, so the panel gets real
 * types (rather than the `unknown`-in/`unknown`-out registry shape) while the
 * one getShell()-routed implementation stays in the map alongside the other
 * browser ops. On a non-fork host these reject with the same clear reason
 * getShell() throws; the panel catches and shows it.
 */
export interface BrowserPrefsApi {
  /** Read Chromium's own settings by preference name. Names the browser does
   *  not allowlist come back `unavailable`, never as an error. */
  getSettingPrefs(names: string[]): Promise<SettingPref[]>
  /** Write one. False when the name is refused, the type is wrong, or policy
   *  controls it. */
  setSettingPref(name: string, value: boolean | number | string): Promise<boolean>
  /** Show the browser's open panel and load whatever the user picks. */
  openLocalFile(
    tabId: string
  ): Promise<{ navigated: boolean; document: { path: string; auth: string } | null }>
  /** Open a file the core staged from a drop, by its bare name. */
  getBlockThirdPartyCookies(): Promise<boolean>
  setBlockThirdPartyCookies(blocked: boolean): Promise<void>
  getSendDoNotTrack(): Promise<boolean>
  setSendDoNotTrack(enabled: boolean): Promise<void>
  getHttpsOnlyMode(): Promise<boolean>
  setHttpsOnlyMode(enabled: boolean): Promise<void>
  getPreloadPages(): Promise<boolean>
  setPreloadPages(enabled: boolean): Promise<void>
  getAdblockEnabled(): Promise<boolean>
  setAdblockEnabled(enabled: boolean): Promise<void>
  getAdblockBlockedCount(): Promise<number>
  clearBrowsingData(
    cookies: boolean,
    cache: boolean,
    history: boolean,
    timeRange: number
  ): Promise<void>
  getDefaultBrowserState(): Promise<BrowserDefaultState>
  makeDefaultBrowser(): Promise<BrowserDefaultState>
}

export const browserPrefs: BrowserPrefsApi = {
  getSettingPrefs: (names) =>
    SHELL_BROWSER[IpcChannels.browserGetSettingPrefs](names) as Promise<SettingPref[]>,
  setSettingPref: (name, value) =>
    SHELL_BROWSER[IpcChannels.browserSetSettingPref](
      name,
      JSON.stringify(value)
    ) as Promise<boolean>,
  openLocalFile: (tabId) =>
    SHELL_BROWSER[IpcChannels.browserOpenLocalFile](tabId) as Promise<{
      navigated: boolean
      document: { path: string; auth: string } | null
    }>,
  getBlockThirdPartyCookies: () =>
    SHELL_BROWSER[IpcChannels.browserGetCookieBlock]() as Promise<boolean>,
  setBlockThirdPartyCookies: async (blocked) => {
    await SHELL_BROWSER[IpcChannels.browserSetCookieBlock](blocked)
  },
  getSendDoNotTrack: () => SHELL_BROWSER[IpcChannels.browserGetDnt]() as Promise<boolean>,
  setSendDoNotTrack: async (enabled) => {
    await SHELL_BROWSER[IpcChannels.browserSetDnt](enabled)
  },
  getHttpsOnlyMode: () => SHELL_BROWSER[IpcChannels.browserGetHttpsOnly]() as Promise<boolean>,
  setHttpsOnlyMode: async (enabled) => {
    await SHELL_BROWSER[IpcChannels.browserSetHttpsOnly](enabled)
  },
  getPreloadPages: () => SHELL_BROWSER[IpcChannels.browserGetPreload]() as Promise<boolean>,
  setPreloadPages: async (enabled) => {
    await SHELL_BROWSER[IpcChannels.browserSetPreload](enabled)
  },
  getAdblockEnabled: () => SHELL_BROWSER[IpcChannels.browserGetAdblock]() as Promise<boolean>,
  setAdblockEnabled: async (enabled) => {
    await SHELL_BROWSER[IpcChannels.browserSetAdblock](enabled)
  },
  getAdblockBlockedCount: () =>
    SHELL_BROWSER[IpcChannels.browserGetAdblockCount]() as Promise<number>,
  clearBrowsingData: async (cookies, cache, history, timeRange) => {
    await SHELL_BROWSER[IpcChannels.browserClearData](cookies, cache, history, timeRange)
  },
  getDefaultBrowserState: () =>
    SHELL_BROWSER[IpcChannels.browserDefaultStatus]() as Promise<BrowserDefaultState>,
  makeDefaultBrowser: () =>
    SHELL_BROWSER[IpcChannels.browserMakeDefault]() as Promise<BrowserDefaultState>
}

/**
 * WebDeck split view, typed for the Toolbar (see SPLIT_VIEW_PLAN.md).
 *
 * A thin facade over the `SHELL_BROWSER` handlers, so the Toolbar imports a real
 * type rather than the `unknown`-in registry shape — the same pattern as
 * `browserPrefs`. Split staging exists only on the fork (the Mojo Shell); off
 * fork these reject with the clear reason getShell() throws.
 *
 * `enable`/`disable` bind (or unbind) the two staged tabs; the shell drives the
 * primary stage rect through the existing setBounds path and the secondary rect
 * through `setSecondaryBounds`, drawing the divider between them in its own DOM.
 */
export interface SplitViewApi {
  enable(primaryTabId: string, secondaryTabId: string): Promise<void>
  disable(): Promise<void>
  setSecondaryBounds(rect: Rect): Promise<void>
}

export const splitView: SplitViewApi = {
  enable: async (primaryTabId, secondaryTabId) => {
    await SHELL_BROWSER[IpcChannels.browserSetSplit](true, primaryTabId, secondaryTabId)
  },
  disable: async () => {
    // Ids are ignored when disabling; pass empty so handleFor() -> ACTIVE.
    await SHELL_BROWSER[IpcChannels.browserSetSplit](false, '', '')
  },
  setSecondaryBounds: async (rect) => {
    await SHELL_BROWSER[IpcChannels.browserSetSecondaryBounds](rect)
  }
}

/** Picture-in-Picture toggle for a staged tab (fork only), typed for the Toolbar. */
export interface PictureInPictureApi {
  toggle(tabId: string): Promise<void>
}

export const pictureInPicture: PictureInPictureApi = {
  toggle: async (tabId) => {
    await SHELL_BROWSER[IpcChannels.browserPictureInPicture](tabId)
  }
}

/**
 * The active tab's rendered visible text, typed for the Page Assistant block
 * (roadmap A4). A thin facade over the `SHELL_BROWSER` handler — the same
 * pattern as `browserPrefs`/`splitView`/`pictureInPicture` — so the block gets a
 * real `Promise<string>` rather than the `unknown`-in registry shape.
 *
 * Fork-only: reading the window's real tab needs the Mojo Shell, so off the fork
 * this rejects with the clear reason getShell() throws (the block catches it and
 * chats with an empty page rather than surfacing a wiring error to the user).
 * `tabId` 0 addresses the active (staged) tab.
 */
export interface PageTextApi {
  get(tabId: number): Promise<string>
}

export const pageText: PageTextApi = {
  get: (tabId) => SHELL_BROWSER[IpcChannels.browserGetPageText](tabId) as Promise<string>
}
