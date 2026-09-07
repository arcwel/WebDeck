import { create } from 'zustand'

/** Which composer a draft is addressed to: the Deck's, or the assistant
 *  panel's. Without it the first mounted composer claims every draft. */
export type ComposerSurface = 'deck' | 'assistant'

import { docNavTarget } from '@shared/ipc'
import type { BrowserTabState, ImportedVisitInfo, WorkspaceInfo } from '@shared/ipc'
import type { HistoryEntry } from '@/omnibox-rank'
import { emptyStartSites, type StartSites } from '@/start-sites'
import type { AgentAttachment, AgentSessionInfo } from '@shared/agents'
import type {
  BlockGroup,
  BlockInstance,
  BlockType,
  DeckMode,
  DeckPreset,
  DeckSizes,
  DeckSyncState,
  DeckZone,
  DockZone,
  RailEntry
} from '@shared/deck'
import { UNMEASURED_CAPACITY, foldZone, insertGroup, placeBlock, placeGroup } from '@/deck-capacity'

export type { BlockGroup, BlockInstance, BlockType, DeckMode, DeckPreset, DeckZone, RailEntry }

export type Theme = 'light' | 'dark'

/** A browser tab in the tab strip. Page state lives in `browserStates`. */
export interface BrowserTab {
  id: string
  /** 'web' hosts a Chromium view; 'doc' renders a Document Studio view. */
  kind: 'web' | 'doc'
  title: string
  /** For tabs opened from a link: the URL to load on first mount. */
  initialUrl?: string
  /** The page's favicon as a data: URL, mirrored from browser state. */
  favicon?: string
  /** Document Studio tabs: the workspace-relative file being rendered. */
  docPath?: string
  /** True once a WebContentsView exists for this tab (first navigation). */
  hasContent: boolean
  /** Tab group this belongs to, if any (Chrome-style grouping). */
  groupId?: string
}

/** A named, coloured run of tabs. Groups keep their tabs adjacent. */
export interface TabGroup {
  id: string
  name: string
  color: TabGroupColor
  collapsed: boolean
}

export type TabGroupColor = 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate'

export const TAB_GROUP_COLORS: Record<TabGroupColor, { dot: string; chip: string }> = {
  sky: { dot: 'bg-sky-500', chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  emerald: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  rose: { dot: 'bg-rose-500', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  slate: { dot: 'bg-slate-500', chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' }
}

// Canonical in @shared/ipc so the main process (browser-navigation interception)
// and the renderer agree on what counts as a doc; re-exported here for the many
// existing `@/store` importers.
export { DOC_EXTENSIONS, isDocFile, isSlidesFile } from '@shared/ipc'

/** Where a dragged block or group is dropped. */
export type DropTarget =
  | { kind: 'stack'; groupId: string }
  | { kind: 'before'; groupId: string }
  | { kind: 'zone'; zone: DeckZone }

export const BLOCK_LABELS: Record<BlockType, string> = {
  editor: 'Editor',
  files: 'Files',
  terminal: 'Terminal',
  agents: 'Agents',
  logs: 'Logs',
  search: 'Search',
  preview: 'Preview',
  scm: 'Source Control',
  tasks: 'Tasks',
  settings: 'Settings',
  debug: 'Debug',
  chat: 'Page Assistant',
  gitgraph: 'Git Graph',
  rest: 'REST Client',
  db: 'Database',
  jupyter: 'Notebook',
  extensions: 'Extensions',
  // Fallback only — an extview block is titled after its view container.
  extview: 'Extension view'
}

/** Which shell window this renderer is: the browser, the detached deck, or a float. */
export function getWindowRole(): { kind: 'main' | 'deck' | 'float'; groupId?: string } {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'deck') return { kind: 'deck' }
  if (hash.startsWith('float:')) return { kind: 'float', groupId: hash.slice('float:'.length) }
  return { kind: 'main' }
}

/** Terminals are always numbered (Terminal 1, Terminal 2); others only from 2. */
let blockCounts: Partial<Record<BlockType, number>> = {}
let nextBlockId = 1
let nextGroupId = 1

function makeBlock(
  type: BlockType,
  payload?: BlockInstance['payload'],
  title?: string
): BlockInstance {
  const n = (blockCounts[type] = (blockCounts[type] ?? 0) + 1)
  const numbered = type === 'terminal' || n > 1
  return {
    id: `block-${nextBlockId++}`,
    type,
    // An extension view is titled after its container, never numbered — the
    // same container in two blocks is not a thing (a view lives in one place).
    title: title ?? (numbered ? `${BLOCK_LABELS[type]} ${n}` : BLOCK_LABELS[type]),
    ...(payload ? { payload } : {})
  }
}

/** Capacity for a zone; floating groups are never folded. */
function capacityOf(state: { zoneCapacity: Record<DockZone, number> }, zone: DeckZone): number {
  return zone === 'floating' ? UNMEASURED_CAPACITY : state.zoneCapacity[zone]
}

function makeGroup(zone: DeckZone, members: BlockInstance[]): BlockGroup {
  return {
    id: `group-${nextGroupId++}`,
    zone,
    blockIds: members.map((b) => b.id),
    activeBlockId: members[members.length - 1]?.id ?? ''
  }
}

let nextTabId = 1
let nextTabGroupId = 1
function makeTab(initialUrl?: string): BrowserTab {
  return { id: `tab-${nextTabId++}`, kind: 'web', title: 'New Tab', initialUrl, hasContent: false }
}

function makeDocTab(docPath: string): BrowserTab {
  return {
    id: `tab-${nextTabId++}`,
    kind: 'doc',
    title: docPath.split('/').pop() ?? docPath,
    docPath,
    hasContent: false
  }
}

interface DeckLayout {
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckSizes?: DeckSizes
  /** Persisted so a renderer crash-reload doesn't close a detached deck. */
  deckMode?: DeckMode
}

function defaultDeck(): DeckLayout {
  const editor = makeBlock('editor')
  const files = makeBlock('files')
  const terminal = makeBlock('terminal')
  const agents = makeBlock('agents')
  return {
    blocks: {
      [editor.id]: editor,
      [files.id]: files,
      [terminal.id]: terminal,
      [agents.id]: agents
    },
    // Agents opens as the entire right column: the largest block by default
    // and deliberately not grouped with Terminal. It stays an ordinary block —
    // draggable, floatable, railable, closable like any other.
    groups: [
      makeGroup('right', [agents]),
      makeGroup('bottom', [editor]),
      makeGroup('bottom', [terminal]),
      makeGroup('bottom', [files])
    ],
    rail: []
  }
}

/* ---- Per-project layout persistence (localStorage) ---- */

// Only the main (browser) window restores or saves persisted layout. Child
// windows (deck/float) receive the live layout via the boot-time sync request;
// restoring localStorage there would broadcast a stale snapshot that clobbers
// the live state — e.g. un-floating the very group a float window was opened
// for, which closes that window immediately.
const isLayoutAuthority = getWindowRole().kind === 'main'

const DEFAULT_DECK_SIZES: DeckSizes = {
  colWidth: 436,
  // The left column starts closed: it exists as a drop target, and only takes
  // space once something is actually put there.
  leftWidth: 0,
  dockHeight: 248,
  dockWidths: {},
  // The dock runs the full width by default: a column that stopped above it
  // left a dead square in the corner, which nothing could use.
  corners: { left: 'dock', right: 'dock' }
}

/**
 * The width a left column opens at when the store still says 0.
 *
 * 0 means "closed"; the first block dropped into the column opens it without
 * writing a width, so the layout falls back to this. A resize has to start
 * from the width on screen, not from 0 — a drag that began at 0 jumped the
 * column to its minimum on the first pixel of movement.
 */
export const DEFAULT_LEFT_WIDTH = 320

export function effectiveLeftWidth(sizes: DeckSizes): number {
  return sizes.leftWidth > 0 ? sizes.leftWidth : DEFAULT_LEFT_WIDTH
}

/** Keep resizes within sane, on-screen bounds. */
export function clampDeckSizes(sizes: DeckSizes): DeckSizes {
  return {
    colWidth: Math.min(820, Math.max(280, Math.round(sizes.colWidth))),
    // 0 is meaningful (closed); anything open gets a usable minimum.
    leftWidth: sizes.leftWidth <= 0 ? 0 : Math.min(820, Math.max(220, Math.round(sizes.leftWidth))),
    dockHeight: Math.min(520, Math.max(140, Math.round(sizes.dockHeight))),
    dockWidths: Object.fromEntries(
      Object.entries(sizes.dockWidths ?? {}).map(([id, width]) => [
        id,
        Math.min(1400, Math.max(220, Math.round(width)))
      ])
    ),
    corners: {
      left: sizes.corners?.left === 'column' ? 'column' : 'dock',
      right: sizes.corners?.right === 'column' ? 'column' : 'dock'
    }
  }
}

interface LayoutSnapshot extends DeckLayout {
  deckSizes?: DeckSizes
  counters: {
    nextBlockId: number
    nextGroupId: number
    blockCounts: Partial<Record<BlockType, number>>
  }
}

const layoutKey = (workspacePath: string | null): string =>
  `agweb.layout:${workspacePath ?? 'default'}`

/** Pack live deck layout into its persisted shape. Shared by the per-workspace
 *  autosave and named snapshots so both capture the deck identically. */
function serializeLayout(state: {
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckSizes: DeckSizes
  deckMode: DeckMode
}): LayoutSnapshot {
  return {
    blocks: state.blocks,
    groups: state.groups,
    rail: state.rail,
    deckSizes: state.deckSizes,
    deckMode: state.deckMode,
    counters: { nextBlockId, nextGroupId, blockCounts }
  }
}

/** Rehydrate a layout snapshot, bumping the id counters past the saved ones so
 *  freshly minted blocks/groups never collide with restored ids. Pure: the
 *  localStorage read lives in `loadLayout`, so named snapshots can reuse this. */
function rebuildLayout(snap: LayoutSnapshot): DeckLayout | null {
  if (!snap.groups || !snap.blocks) return null
  nextBlockId = Math.max(nextBlockId, snap.counters?.nextBlockId ?? 1)
  nextGroupId = Math.max(nextGroupId, snap.counters?.nextGroupId ?? 1)
  blockCounts = { ...blockCounts, ...snap.counters?.blockCounts }
  return {
    blocks: snap.blocks,
    groups: snap.groups,
    rail: snap.rail ?? [],
    deckSizes: clampDeckSizes(snap.deckSizes ?? DEFAULT_DECK_SIZES),
    deckMode: snap.deckMode === 'detached' ? 'detached' : 'attached'
  }
}

function loadLayout(workspacePath: string | null): DeckLayout | null {
  if (!isLayoutAuthority) return null
  try {
    const raw = localStorage.getItem(layoutKey(workspacePath))
    if (!raw) return null
    return rebuildLayout(JSON.parse(raw) as LayoutSnapshot)
  } catch {
    return null
  }
}

function saveLayout(state: {
  workspace: WorkspaceInfo | null
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]
  deckSizes: DeckSizes
  deckMode: DeckMode
}): void {
  if (!isLayoutAuthority) return
  try {
    localStorage.setItem(
      layoutKey(state.workspace?.path ?? null),
      JSON.stringify(serializeLayout(state))
    )
  } catch {
    // storage unavailable — layout just won't persist
  }
}

/* ---- Bookmarks (localStorage, shared across projects) ---- */

/** Bookmarks are per profile, so switching profile switches the set (Chrome). */
function bmKey(profileId: string): string {
  return `agweb.bookmarks:${profileId}`
}

function loadBookmarks(profileId: string): Array<{ url: string; title: string }> {
  try {
    // One-time migration: the old global bookmarks become the default profile's.
    const legacy = localStorage.getItem('agweb.bookmarks')
    if (legacy !== null && localStorage.getItem(bmKey('default')) === null) {
      localStorage.setItem(bmKey('default'), legacy)
      localStorage.removeItem('agweb.bookmarks')
    }
    const raw = localStorage.getItem(bmKey(profileId))
    return raw ? (JSON.parse(raw) as Array<{ url: string; title: string }>) : []
  } catch {
    return []
  }
}

function saveBookmarks(profileId: string, bookmarks: Array<{ url: string; title: string }>): void {
  try {
    localStorage.setItem(bmKey(profileId), JSON.stringify(bookmarks))
  } catch {
    // storage unavailable — bookmarks just won't persist
  }
}

/* ---- Start page sites (localStorage, per profile — mirrors bookmarks) ---- */

function startSitesKey(profileId: string): string {
  return `agweb.start-sites:${profileId}`
}

function loadStartSites(profileId: string): StartSites {
  try {
    const raw = localStorage.getItem(startSitesKey(profileId))
    if (!raw) return emptyStartSites()
    const parsed = JSON.parse(raw) as Partial<StartSites>
    return {
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : []
    }
  } catch {
    return emptyStartSites()
  }
}

function saveStartSites(profileId: string, sites: StartSites): void {
  try {
    localStorage.setItem(startSitesKey(profileId), JSON.stringify(sites))
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

/* ---- Browsing history (localStorage, per profile — mirrors bookmarks) ---- */

/** Cap the stored history: this backs autocomplete, not a forensic log. */
const HISTORY_CAP = 3000

function historyKey(profileId: string): string {
  return `agweb.history:${profileId}`
}

function loadHistory(profileId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(profileId))
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function saveHistory(profileId: string, history: HistoryEntry[]): void {
  try {
    localStorage.setItem(historyKey(profileId), JSON.stringify(history))
  } catch {
    // storage unavailable — history just won't persist
  }
}

/** Only real web pages belong in the omnibox — skip about:/data:/file: views. */
function isHistoryUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/* ---- Vertical-tabs layout preference (localStorage, global UI pref) ---- */

// The layout mode is a UI preference, not per-workspace state, so it lives in
// its own key (mirroring `agweb.utilitiesLocked`) rather than the per-project
// tab-session snapshot. It survives relaunch and applies to every workspace.
const VERTICAL_TABS_KEY = 'agweb.verticalTabs'

function loadVerticalTabs(): boolean {
  try {
    return localStorage.getItem(VERTICAL_TABS_KEY) === '1'
  } catch {
    return false
  }
}

function saveVerticalTabs(vertical: boolean): void {
  try {
    localStorage.setItem(VERTICAL_TABS_KEY, vertical ? '1' : '0')
  } catch {
    // storage unavailable — the preference just won't persist
  }
}

/* ---- Per-project tab-session persistence (localStorage) ---- */

interface TabSessionSnapshot {
  // `groupId` points at an entry in `groups` by its *saved* id; loadTabSession
  // remints both so restored ids never collide with a live counter.
  tabs: Array<{
    kind: 'web' | 'doc'
    title: string
    url?: string
    docPath?: string
    groupId?: string
  }>
  activeIndex: number
  /** Tab groups active when the session was saved (Chrome-style grouping). */
  groups?: TabGroup[]
}

/**
 * The tab session is the BROWSER's, not the project's. It used to be keyed by
 * workspace path, so opening a project swapped the whole tab strip for that
 * project's saved tabs — pages you had closed came back and the ones you were
 * reading vanished. One session per profile now; the workspace argument is
 * kept so the callers stay unchanged and named snapshots keep their shape.
 */
const tabsKey = (_workspacePath: string | null): string => 'agweb.tabs:default'

/** Pack the live tab strip into its persisted shape. Shared by the per-workspace
 *  autosave and named snapshots so both capture tabs, order, groups and the
 *  active tab identically. */
function serializeTabSession(state: {
  tabs: BrowserTab[]
  activeTabId: string
  browserStates: Record<string, BrowserTabState>
  tabGroups: Record<string, TabGroup>
}): TabSessionSnapshot {
  // Only persist groups that still hold at least one tab — an empty group is
  // dead weight that would restore as an unreachable header.
  const liveGroupIds = new Set(
    state.tabs.map((t) => t.groupId).filter((id): id is string => Boolean(id))
  )
  return {
    tabs: state.tabs.map((tab) =>
      tab.kind === 'doc'
        ? { kind: 'doc', title: tab.title, docPath: tab.docPath, groupId: tab.groupId }
        : {
            kind: 'web',
            title: tab.title,
            url: state.browserStates[tab.id]?.url ?? tab.initialUrl,
            groupId: tab.groupId
          }
    ),
    activeIndex: Math.max(
      0,
      state.tabs.findIndex((t) => t.id === state.activeTabId)
    ),
    groups: Object.values(state.tabGroups).filter((g) => liveGroupIds.has(g.id))
  }
}

/** Rebuild a saved tab strip with fresh ids; pages lazy-load on activation.
 *  Pure: the localStorage read and the "restore tabs" gate live in the callers,
 *  so named snapshots reuse this exact re-minting path. */
function isBlankSavedTab(tab: TabSessionSnapshot['tabs'][number]): boolean {
  if (tab.kind === 'doc') return false
  const url = (tab.url ?? '').trim()
  return url === '' || url === 'about:blank' || url === 'chrome://newtab/'
}

function rebuildTabSession(
  snap: TabSessionSnapshot
): { tabs: BrowserTab[]; activeTabId: string; tabGroups: Record<string, TabGroup> } | null {
  if (!Array.isArray(snap.tabs) || snap.tabs.length === 0) return null
  // A blank tab is not worth restoring: it carries nothing, and a session that
  // accumulated five of them reopens as five empty tabs to close by hand. The
  // window always opens with one anyway.
  const kept = snap.tabs.filter((t) => !isBlankSavedTab(t))
  if (kept.length === 0) return null
  snap = {
    ...snap,
    tabs: kept,
    activeIndex: Math.min(Math.max(0, snap.activeIndex ?? 0), kept.length - 1)
  }
  // Remint group ids so a restored group never shares an id with one minted
  // this session; carry the old→new mapping to re-tag the rebuilt tabs.
  const groupIdMap = new Map<string, string>()
  const tabGroups: Record<string, TabGroup> = {}
  for (const g of snap.groups ?? []) {
    if (!g || typeof g.id !== 'string') continue
    const freshId = `tabgroup-${nextTabGroupId++}`
    groupIdMap.set(g.id, freshId)
    tabGroups[freshId] = {
      id: freshId,
      name: g.name,
      color: g.color,
      collapsed: Boolean(g.collapsed)
    }
  }
  const tabs = snap.tabs.map((t) => {
    const base = t.kind === 'doc' && t.docPath ? makeDocTab(t.docPath) : makeTab(t.url)
    const titled =
      t.kind === 'doc' ? base : t.url ? { ...base, title: t.title || base.title } : base
    const mapped = t.groupId ? groupIdMap.get(t.groupId) : undefined
    return mapped ? { ...titled, groupId: mapped } : titled
  })
  // Drop any group that ended up with no tabs (e.g. its only tab was a web
  // tab dropped by a restore filter in future) so no orphan header shows.
  const used = new Set(tabs.map((t) => t.groupId).filter((id): id is string => Boolean(id)))
  for (const id of Object.keys(tabGroups)) if (!used.has(id)) delete tabGroups[id]
  const active = tabs[Math.min(Math.max(snap.activeIndex ?? 0, 0), tabs.length - 1)]
  return { tabs, activeTabId: active.id, tabGroups }
}

function saveTabSession(state: {
  workspace: WorkspaceInfo | null
  tabs: BrowserTab[]
  activeTabId: string
  browserStates: Record<string, BrowserTabState>
  tabGroups: Record<string, TabGroup>
}): void {
  if (!isLayoutAuthority) return
  try {
    localStorage.setItem(
      tabsKey(state.workspace?.path ?? null),
      JSON.stringify(serializeTabSession(state))
    )
  } catch {
    // storage unavailable — the session just won't persist
  }
}

/** Rebuild a saved tab strip with fresh ids; pages lazy-load on activation. */
function loadTabSession(
  workspacePath: string | null
): { tabs: BrowserTab[]; activeTabId: string; tabGroups: Record<string, TabGroup> } | null {
  if (!isLayoutAuthority) return null
  // Honour the "Restore tabs on launch" setting — off means start fresh.
  try {
    if (!window.agweb.appSettings.readSync().restoreTabs) return null
  } catch {
    // Settings unreadable (e.g. very early boot): fall back to restoring.
  }
  try {
    const raw = localStorage.getItem(tabsKey(workspacePath))
    if (!raw) return null
    return rebuildTabSession(JSON.parse(raw) as TabSessionSnapshot)
  } catch {
    return null
  }
}

/* ---- Named workspace snapshots (localStorage, global across workspaces) ---- */

/**
 * A named capture of a workspace's working state: its tab strip (urls, order,
 * groups, active tab), its deck layout, and its open editor files. A snapshot
 * names a *workspace* state, so it stores the workspace it was taken in and
 * restore targets that workspace. Reuses the same serialized shapes the
 * per-workspace autosaves write, so capture and restore share one code path.
 */
export interface WorkspaceSnapshot {
  id: string
  name: string
  /** The workspace this was captured in; restore returns into it. */
  workspace: WorkspaceInfo | null
  /** Epoch ms the snapshot was taken. */
  savedAt: number
  /** Same shape `saveTabSession` persists. */
  tabSession: TabSessionSnapshot
  /** Same shape `saveLayout` persists. */
  layout: LayoutSnapshot
  /** Open editor documents (workspace-relative paths) and the focused one. */
  editorTabs: string[]
  activeEditorPath: string | null
}

const SNAPSHOTS_KEY = 'agweb.snapshots'
let nextSnapshotId = 1

function loadSnapshots(): WorkspaceSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as WorkspaceSnapshot[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Returns whether the write actually landed — the caller surfaces a failure
 *  (e.g. quota exceeded) instead of falsely reporting the snapshot saved. */
function saveSnapshots(snapshots: WorkspaceSnapshot[]): boolean {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots))
    return true
  } catch {
    // storage unavailable (e.g. quota exceeded) — snapshots won't persist
    return false
  }
}

/* ---- Group surgery helpers (pure) ---- */

/** Remove a block from whichever group holds it; dissolve emptied groups. */
function withoutBlock(groups: BlockGroup[], blockId: string): BlockGroup[] {
  return groups
    .map((g) => {
      if (!g.blockIds.includes(blockId)) return g
      const blockIds = g.blockIds.filter((id) => id !== blockId)
      const activeBlockId =
        g.activeBlockId === blockId ? (blockIds[blockIds.length - 1] ?? '') : g.activeBlockId
      return { ...g, blockIds, activeBlockId }
    })
    .filter((g) => g.blockIds.length > 0)
}

/** A transient notification shown by the ToastHost (P2-13 and general use). */
export type ToastTone = 'info' | 'warn' | 'error'
export interface Toast {
  id: string
  message: string
  tone: ToastTone
}
let nextToastId = 1

interface ShellState {
  workspace: WorkspaceInfo | null
  theme: Theme

  tabs: BrowserTab[]
  activeTabId: string
  browserStates: Record<string, BrowserTabState>

  deckRevealed: boolean
  deckMode: DeckMode
  deckSizes: DeckSizes
  blocks: Record<string, BlockInstance>
  groups: BlockGroup[]
  rail: RailEntry[]

  /** Open editor documents (workspace-relative paths), shared by all editors. */
  editorTabs: string[]
  activeEditorPath: string | null
  dirtyFiles: Record<string, boolean>

  /** Agent sessions, pushed from main (every window gets agentUpdate events). */
  agentSessions: Record<string, AgentSessionInfo>
  upsertAgentSession(session: AgentSessionInfo): void
  setAgentSessions(sessions: AgentSessionInfo[]): void

  setWorkspace(workspace: WorkspaceInfo | null): void
  /**
   * Restore the profile's saved tab strip, once, at boot (honours the
   * "Restore tabs on launch" setting). Tabs belong to the browser, not to a
   * project, so this is the ONLY place a saved strip replaces the live one —
   * a project switch never does (see tabsKey).
   */
  restoreTabSession(): void
  setTheme(theme: Theme): void

  newTab(initialUrl?: string): string
  /**
   * Adopt a browser view the browser created but the shell did not: an agent
   * view from main, or a tab a page opened itself (window.open / target=_blank).
   * `url`/`title` seed the strip until the first browserState push refines them.
   */
  adoptBrowserTab(id: string, url?: string, title?: string): void
  /** Open (or focus) a Document Studio tab for a workspace file. */
  openDoc(path: string): void
  closeTab(id: string): void
  activateTab(id: string): void
  /** Drag-and-drop: move a tab before `beforeId` (or to the end when null). */
  moveTab(id: string, beforeId: string | null): void
  markTabHasContent(id: string): void
  updateBrowserState(state: BrowserTabState): void

  /** Renderer popovers open over the stage. Native WebContentsViews paint
   *  above the DOM, so the active view is hidden while any overlay is up. */
  overlayCount: number
  setOverlayOpen(open: boolean): void
  /** The Settings surface opens as its own overlay over the stage, not as a
   *  Dev Deck block — Settings is not part of the developer workspace. */
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  /** The Session Snapshots surface opens as its own overlay over the stage,
   *  like Settings — so both the hotkey and the command palette can raise it. */
  snapshotsOpen: boolean
  setSnapshotsOpen(open: boolean): void
  /** Reader Mode: a distraction-free reading overlay for the active tab. When
   *  open, ReaderView raises the overlay count so the native view yields to its
   *  in-DOM reading column. Toggled from the toolbar and closed on Escape. */
  readerOpen: boolean
  setReaderOpen(open: boolean): void
  toggleDeck(): void
  /** Pop the whole deck out into its own IDE window. */
  detachDeck(): void
  /** Merge the detached deck back into the browser window. */
  attachDeck(): void
  activateBlock(groupId: string, blockId: string): void
  /** Open another instance of `type` as a new tab in `groupId`. */
  addBlockToGroup(groupId: string, type: BlockType): void
  closeBlock(blockId: string): void
  /** Drag-and-drop: move one block (tab) to a target. */
  moveBlock(blockId: string, target: DropTarget): void
  /** Drag-and-drop: move a whole group (stack) to a target. */
  moveGroup(groupId: string, target: DropTarget): void
  /** Collapse a block to the rail; restore puts it back in its old zone. */
  /** Edge-resize (2B.3): set the deck column width / dock height. */
  setDeckSizes(sizes: Partial<DeckSizes>): void
  /** Flip who owns a bottom corner: the dock under the column, or the column beside the dock. */
  toggleDeckCorner(side: 'left' | 'right'): void
  /** Pin bottom-dock block widths (merged, so one drag can set both sides). */
  setDockWidths(widths: Record<string, number>): void
  /**
   * How many groups each dock zone can show at the minimum group size —
   * measured by the zone views. Blocks never overlap: past capacity a new
   * block becomes a tab, and shrinking capacity folds groups together.
   */
  zoneCapacity: Record<DockZone, number>
  setZoneCapacity(zone: DockZone, capacity: number): void
  sendToRail(blockId: string): void
  restoreFromRail(blockId: string): void
  applyPreset(preset: DeckPreset): void

  openFile(path: string, line?: number): void

  /** A turn handed back to the composer for editing before it is sent again
   *  (task 11.13). Null once the composer has picked it up. */
  /**
   * Tab-strip layout: false renders the horizontal strip, true a vertical left
   * rail. A UI preference, persisted globally so it survives relaunch. Exposed
   * on the store so the surrounding layout (Stage/App) can reserve rail width.
   */
  verticalTabs: boolean
  setVerticalTabs(vertical: boolean): void
  toggleVerticalTabs(): void

  /** Tab groups, keyed by id. Tabs point at these by `groupId`. */
  tabGroups: Record<string, TabGroup>
  /** Group the given tabs together, creating the group. Returns its id. */
  groupTabs(tabIds: string[], name?: string): string
  /** Add an existing tab to an existing group, keeping the group contiguous. */
  addTabToGroup(tabId: string, groupId: string): void
  ungroupTab(tabId: string): void
  renameTabGroup(groupId: string, name: string): void
  setTabGroupColor(groupId: string, color: TabGroupColor): void
  toggleTabGroup(groupId: string): void
  /** Dissolve the group, leaving its tabs in place. */
  removeTabGroup(groupId: string): void

  /**
   * Split view: a second tab shown beside the active one (feedback item 5).
   * This is a *page* split — two live web views side by side — not a deck
   * layout, which is what the Split view tool used to do by mistake.
   */
  splitTabId: string | null
  /** 0..1 — where the divider sits between the two pages. */
  splitRatio: number
  setSplit(tabId: string | null): void
  setSplitRatio(ratio: number): void
  /** Show the next tab beside this one, or close the split if one is open. */
  toggleSplit(): void
  /** URLs of recently closed web tabs, newest last (⌘⇧T). */
  closedTabs: string[]
  reopenTab(): void

  /** Embed proxy state, shared so the toolbar indicator and the menu that
   *  toggles it can never disagree. */
  embedProxyEnabled: boolean
  setEmbedProxyEnabled(enabled: boolean): void

  /** The summonable utilities/favourites bar (design canvas). */
  utilitiesOpen: boolean
  utilitiesLocked: boolean
  setUtilitiesOpen(open: boolean): void
  setUtilitiesLocked(locked: boolean): void

  /** The active browser profile id, mirrored from main so bookmarks follow it. */
  activeProfileId: string
  /** Switch the renderer to a profile: reload its bookmarks. */
  syncProfile(profileId: string): void
  /** Bookmarked pages for the active profile, newest first. */
  bookmarks: Array<{ url: string; title: string }>
  addBookmark(url: string, title: string): void
  removeBookmark(url: string): void
  /** Which sites the start page shows: pinned always, hidden never. */
  startSites: StartSites
  pinStartSite(url: string, title?: string): void
  unpinStartSite(url: string): void
  hideStartSite(url: string): void
  unhideStartSite(url: string): void
  /** Merge an imported set into the active profile's bookmarks (deduped). */
  importBookmarks(items: Array<{ url: string; title: string }>): number
  /** Visited pages for the active profile, most-relevant first — omnibox source. */
  history: HistoryEntry[]
  /** Record (or refresh) a visit; called as browser state updates flow in. */
  recordVisit(url: string, title: string, favicon?: string): void
  /** Merge history imported from another browser into this profile. */
  importHistory(entries: ImportedVisitInfo[]): number
  /** Forget the active profile's browsing history. */
  clearHistory(): void
  /** The page the Home button goes to. */
  homeUrl: string
  setHomeUrl(url: string): void

  /** Breakpoints by workspace-relative path, one-based lines (task 12.4). */
  breakpoints: Record<string, number[]>
  toggleBreakpoint(path: string, line: number): void

  /** `target` addresses one composer. Without it the first mounted composer
   *  claims the draft — which, when Ask opens the assistant panel, was the
   *  Deck's composer being unmounted in the same commit: it took the page and
   *  vanished with it. */
  composerDraft: { text: string; attachments: AgentAttachment[]; target?: ComposerSurface } | null
  /** Fill the composer. `reveal` opens the Deck with it, which is what an
   *  edit-and-resend wants and what the assistant panel must not do — asking
   *  about a page should not drag the editor and terminal on screen. */
  loadDraft(
    text: string,
    attachments: AgentAttachment[],
    options?: { reveal?: boolean; target?: ComposerSurface }
  ): void
  /**
   * The assistant panel: the agent as a side panel beside the page, which is
   * what the Ask button opens.
   *
   * Deliberately NOT a Deck zone. Revealing the Deck brings the editor,
   * terminal and file tree with it, which is the wrong answer to "what does
   * this page say" — so this is its own layout, and toggling the Deck neither
   * opens nor closes it.
   */
  assistantOpen: boolean
  openAssistant(): void
  closeAssistant(): void

  /** A block is being dragged right now. An empty zone collapses to a 10px
   *  strip, which is close to unhittable with a block under the cursor — so
   *  while this is true every zone opens into a band you can actually aim at. */
  blockDragging: boolean
  setBlockDragging(dragging: boolean): void
  clearDraft(): void
  closeEditorTab(path: string): void
  setFileDirty(path: string, dirty: boolean): void
  /** Line the editor should scroll to after opening activeEditorPath. */
  pendingRevealLine: number | null
  clearPendingReveal(): void
  toasts: Toast[]
  pushToast(message: string, tone?: ToastTone): void
  dismissToast(id: string): void
  /** Add a fresh block of `type` to the deck as its own group. */
  /** Add a block. `extview` blocks carry the container in `payload` and use `title`. */
  addBlock(type: BlockType, payload?: BlockInstance['payload'], title?: string): void
  /** An agent started a command in its own pty — surface it as a Terminal
   *  block whose id IS the pty session id, so the user watches it live. */
  adoptTerminal(sessionId: string, title: string): void

  /**
   * Named workspace snapshots: capture the current tabs + deck layout + open
   * editors under a name, restore them later. Global across workspaces (a
   * snapshot stores the workspace it belongs to), newest first.
   */
  snapshots: WorkspaceSnapshot[]
  /** Capture the live state as a new snapshot named `name`. Returns whether it
   *  persisted, so the UI can report a storage failure instead of "Saved". */
  saveSnapshot(name: string): boolean
  /** Rebuild tabs, deck layout and editors from a snapshot (re-minting ids). */
  restoreSnapshot(id: string): void
  renameSnapshot(id: string, name: string): void
  deleteSnapshot(id: string): void
}

const initialTab = makeTab()
const initialDeck = loadLayout(null) ?? defaultDeck()

export const useShellStore = create<ShellState>((set) => ({
  workspace: null,
  theme: 'dark',

  tabs: [initialTab],
  activeTabId: initialTab.id,
  browserStates: {},

  overlayCount: 0,
  deckRevealed: false,
  deckMode: initialDeck.deckMode ?? 'attached',
  deckSizes: initialDeck.deckSizes ?? DEFAULT_DECK_SIZES,
  blocks: initialDeck.blocks,
  groups: initialDeck.groups,
  rail: initialDeck.rail,
  editorTabs: [],
  activeEditorPath: null,
  tabGroups: {},
  snapshots: loadSnapshots(),

  verticalTabs: loadVerticalTabs(),
  setVerticalTabs: (vertical) => {
    saveVerticalTabs(vertical)
    set({ verticalTabs: vertical })
  },
  toggleVerticalTabs: () =>
    set((state) => {
      const verticalTabs = !state.verticalTabs
      saveVerticalTabs(verticalTabs)
      return { verticalTabs }
    }),

  groupTabs: (tabIds, name) => {
    if (tabIds.length === 0) return ''
    // The id is minted outside `set` so it can be returned: zustand's setter
    // has no return value, and callers need the group they just made.
    const id = `tabgroup-${nextTabGroupId++}`
    set((state) => {
      const used = Object.values(state.tabGroups).length
      const palette = Object.keys(TAB_GROUP_COLORS) as TabGroupColor[]
      const group: TabGroup = {
        id,
        name: name ?? `Group ${used + 1}`,
        color: palette[used % palette.length],
        collapsed: false
      }
      // Grouped tabs are kept adjacent, the way Chrome does it: a group split
      // across the strip is unreadable and makes collapsing meaningless.
      const members = state.tabs.filter((t) => tabIds.includes(t.id))
      const rest = state.tabs.filter((t) => !tabIds.includes(t.id))
      const anchor = state.tabs.findIndex((t) => t.id === tabIds[0])
      const before = rest.slice(0, Math.max(0, anchor))
      const after = rest.slice(Math.max(0, anchor))
      return {
        tabGroups: { ...state.tabGroups, [id]: group },
        tabs: [...before, ...members.map((t) => ({ ...t, groupId: id })), ...after]
      }
    })
    return id
  },

  addTabToGroup: (tabId, groupId) =>
    set((state) => {
      if (!state.tabGroups[groupId]) return {}
      const moving = state.tabs.find((t) => t.id === tabId)
      if (!moving || moving.groupId === groupId) return {}
      const tagged = { ...moving, groupId }
      const rest = state.tabs.filter((t) => t.id !== tabId)
      // Slot the tab right after the group's current last member so the run
      // stays contiguous (the same invariant groupTabs maintains); if the group
      // has no members yet, append it.
      const lastIndex = rest.reduce((at, t, i) => (t.groupId === groupId ? i : at), -1)
      const tabs =
        lastIndex < 0
          ? [...rest, tagged]
          : [...rest.slice(0, lastIndex + 1), tagged, ...rest.slice(lastIndex + 1)]
      return { tabs }
    }),

  ungroupTab: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, groupId: undefined } : t))
    })),

  renameTabGroup: (groupId, name) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return { tabGroups: { ...state.tabGroups, [groupId]: { ...group, name } } }
    }),

  setTabGroupColor: (groupId, color) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return { tabGroups: { ...state.tabGroups, [groupId]: { ...group, color } } }
    }),

  toggleTabGroup: (groupId) =>
    set((state) => {
      const group = state.tabGroups[groupId]
      if (!group) return {}
      return {
        tabGroups: { ...state.tabGroups, [groupId]: { ...group, collapsed: !group.collapsed } }
      }
    }),

  removeTabGroup: (groupId) =>
    set((state) => {
      const tabGroups = { ...state.tabGroups }
      delete tabGroups[groupId]
      return {
        tabGroups,
        tabs: state.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: undefined } : t))
      }
    }),

  splitTabId: null,
  splitRatio: 0.5,
  setSplit: (tabId) => set({ splitTabId: tabId }),
  setSplitRatio: (ratio) => set({ splitRatio: Math.min(0.85, Math.max(0.15, ratio)) }),
  toggleSplit: () =>
    set((state) => {
      if (state.splitTabId) return { splitTabId: null }
      // Split against another web tab. A doc tab can't back a browser pane, and
      // the active tab can't be its own companion.
      const companion = state.tabs.find((t) => t.id !== state.activeTabId && t.kind === 'web')
      if (companion) return { splitTabId: companion.id }
      // Nothing to split against — open a fresh tab and split against it, so the
      // command always does something rather than silently no-op'ing.
      const tab = makeTab()
      return { tabs: [...state.tabs, tab], splitTabId: tab.id }
    }),

  embedProxyEnabled: false,
  setEmbedProxyEnabled: (enabled) => set({ embedProxyEnabled: enabled }),

  utilitiesOpen: false,
  utilitiesLocked: localStorage.getItem('agweb.utilitiesLocked') === '1',
  setUtilitiesOpen: (open) => set({ utilitiesOpen: open }),
  setUtilitiesLocked: (locked) => {
    try {
      localStorage.setItem('agweb.utilitiesLocked', locked ? '1' : '0')
    } catch {
      // storage unavailable — the pin just won't persist
    }
    set({ utilitiesLocked: locked })
  },

  activeProfileId: 'default',
  syncProfile: (profileId) =>
    set((state) => {
      // An empty id is "the host has no profiles to report", not "the empty
      // profile". Adopting it swapped the user's bookmarks for the empty set
      // and pointed later saves at a key nothing reads back — the bookmarks
      // looked deleted. Under the fork, profiles:list returns exactly that.
      if (!profileId) return {}
      if (profileId === state.activeProfileId) return {}
      return {
        activeProfileId: profileId,
        bookmarks: loadBookmarks(profileId),
        history: loadHistory(profileId),
        startSites: loadStartSites(profileId)
      }
    }),
  startSites: loadStartSites('default'),
  pinStartSite: (url, title) =>
    set((state) => {
      const pinned = [
        ...state.startSites.pinned.filter((p) => p.url !== url),
        { url, title: title ?? '' }
      ]
      // A pinned site is wanted: it comes off the hidden list too.
      const startSites = { pinned, hidden: state.startSites.hidden.filter((h) => h !== url) }
      saveStartSites(state.activeProfileId, startSites)
      return { startSites }
    }),
  unpinStartSite: (url) =>
    set((state) => {
      const startSites = {
        ...state.startSites,
        pinned: state.startSites.pinned.filter((p) => p.url !== url)
      }
      saveStartSites(state.activeProfileId, startSites)
      return { startSites }
    }),
  hideStartSite: (url) =>
    set((state) => {
      const startSites = {
        pinned: state.startSites.pinned.filter((p) => p.url !== url),
        hidden: state.startSites.hidden.includes(url)
          ? state.startSites.hidden
          : [...state.startSites.hidden, url]
      }
      saveStartSites(state.activeProfileId, startSites)
      return { startSites }
    }),
  unhideStartSite: (url) =>
    set((state) => {
      const startSites = {
        ...state.startSites,
        hidden: state.startSites.hidden.filter((h) => h !== url)
      }
      saveStartSites(state.activeProfileId, startSites)
      return { startSites }
    }),
  bookmarks: loadBookmarks('default'),
  addBookmark: (url, title) =>
    set((state) => {
      if (!url || state.bookmarks.some((b) => b.url === url)) return {}
      const bookmarks = [{ url, title: title || url }, ...state.bookmarks].slice(0, 500)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    }),
  removeBookmark: (url) =>
    set((state) => {
      const bookmarks = state.bookmarks.filter((b) => b.url !== url)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    }),
  importBookmarks: (items) => {
    let added = 0
    set((state) => {
      const seen = new Set(state.bookmarks.map((b) => b.url))
      const fresh = items.filter((i) => i.url && !seen.has(i.url))
      added = fresh.length
      if (fresh.length === 0) return {}
      const bookmarks = [...state.bookmarks, ...fresh].slice(0, 2000)
      saveBookmarks(state.activeProfileId, bookmarks)
      return { bookmarks }
    })
    return added
  },
  history: loadHistory('default'),
  importHistory: (entries) => {
    let added = 0
    set((state) => {
      const known = new Set(state.history.map((h) => h.url))
      const incoming = entries
        .filter((e) => isHistoryUrl(e.url))
        .map((e) => ({
          url: e.url,
          title: e.title || e.url,
          visitCount: Math.max(1, e.visitCount),
          lastVisit: e.lastVisit
        }))
      if (incoming.length === 0) return {}
      added = incoming.filter((e) => !known.has(e.url)).length
      // A page both sides know keeps the higher visit count and the more
      // recent visit: importing twice must not double anything, and the two
      // browsers are describing the same page.
      const byUrl = new Map<string, HistoryEntry>()
      const all: HistoryEntry[] = [...state.history, ...incoming]
      for (const entry of all) {
        const found = byUrl.get(entry.url)
        if (!found) {
          byUrl.set(entry.url, { ...entry })
          continue
        }
        found.visitCount = Math.max(found.visitCount, entry.visitCount)
        if (entry.lastVisit > found.lastVisit) {
          found.lastVisit = entry.lastVisit
          if (entry.title && entry.title !== entry.url) found.title = entry.title
        }
        found.favicon = found.favicon ?? entry.favicon
      }
      const history = [...byUrl.values()]
        .sort((a, b) => b.lastVisit - a.lastVisit)
        .slice(0, HISTORY_CAP)
      saveHistory(state.activeProfileId, history)
      return { history }
    })
    return added
  },

  recordVisit: (url, title, favicon) =>
    set((state) => {
      if (!isHistoryUrl(url)) return {}
      const front = state.history[0]
      if (front && front.url === url) {
        // Title and favicon arrive after the URL, and a reload re-fires the
        // whole sequence — refresh the front entry in place rather than
        // inflating its visit count on every browser-state push.
        const nextTitle = title || front.title
        const nextFavicon = favicon ?? front.favicon
        if (nextTitle === front.title && nextFavicon === front.favicon) return {}
        const history = [
          { ...front, title: nextTitle, favicon: nextFavicon, lastVisit: Date.now() },
          ...state.history.slice(1)
        ]
        saveHistory(state.activeProfileId, history)
        return { history }
      }
      const existing = state.history.find((h) => h.url === url)
      const entry: HistoryEntry = {
        url,
        title: title || existing?.title || url,
        favicon: favicon ?? existing?.favicon,
        visitCount: (existing?.visitCount ?? 0) + 1,
        lastVisit: Date.now()
      }
      const history = [entry, ...state.history.filter((h) => h.url !== url)].slice(0, HISTORY_CAP)
      saveHistory(state.activeProfileId, history)
      return { history }
    }),
  clearHistory: () =>
    set((state) => {
      saveHistory(state.activeProfileId, [])
      return { history: [] }
    }),
  homeUrl: localStorage.getItem('agweb.home') ?? 'https://duckduckgo.com',
  setHomeUrl: (url) => {
    try {
      localStorage.setItem('agweb.home', url)
    } catch {
      // storage unavailable — the home page just won't persist
    }
    set({ homeUrl: url })
  },

  breakpoints: {},
  toggleBreakpoint: (path, line) =>
    set((state) => {
      const lines = state.breakpoints[path] ?? []
      const next = lines.includes(line)
        ? lines.filter((l) => l !== line)
        : [...lines, line].sort((a, b) => a - b)
      return { breakpoints: { ...state.breakpoints, [path]: next } }
    }),

  composerDraft: null,
  loadDraft: (text, attachments, options) =>
    set(
      options?.reveal === false
        ? { composerDraft: { text, attachments, target: options?.target } }
        : { composerDraft: { text, attachments, target: options?.target }, deckRevealed: true }
    ),
  assistantOpen: false,
  // The Ask panel and the Dev Deck never share a window. Opening Ask folds an
  // attached Deck away; a Deck in its own window is left alone. The reverse
  // rule — the Deck coming forward closes Ask — lives in the subscription
  // below the store, so every path that reveals the Deck obeys it.
  openAssistant: () =>
    set((state) => ({
      assistantOpen: true,
      deckRevealed: state.deckMode === 'attached' ? false : state.deckRevealed
    })),
  closeAssistant: () => set({ assistantOpen: false }),

  blockDragging: false,
  setBlockDragging: (dragging) => set({ blockDragging: dragging }),
  clearDraft: () => set({ composerDraft: null }),
  dirtyFiles: {},
  agentSessions: {},

  upsertAgentSession: (session) =>
    set((state) => ({ agentSessions: { ...state.agentSessions, [session.id]: session } })),

  setAgentSessions: (sessions) =>
    set({ agentSessions: Object.fromEntries(sessions.map((s) => [s.id, s])) }),

  setWorkspace: (workspace) =>
    set((state) => {
      if (workspace?.path === state.workspace?.path) return { workspace }
      // Only the Deck layout is per project. The tab strip is the browser's
      // and stays exactly as it is across a project switch — no saved strip is
      // swapped in, no live page is torn down (see tabsKey).
      const layout = loadLayout(workspace?.path ?? null)
      return {
        workspace,
        ...(layout ?? {})
      }
    }),

  restoreTabSession: () =>
    set((state) => {
      const session = loadTabSession(null)
      if (!session) return {}
      // Boot: the strip is the initial blank tab; nothing has content yet, but
      // guard anyway so a late call never leaks a native view.
      for (const tab of state.tabs) {
        if (tab.kind === 'web' && tab.hasContent) void window.agweb.browser.destroy(tab.id)
      }
      return { ...session, browserStates: {} }
    }),

  setTheme: (theme) => set({ theme }),

  newTab: (initialUrl) => {
    const tab = makeTab(initialUrl)
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    return tab.id
  },

  adoptBrowserTab: (id, url, title) =>
    set((state) => {
      if (state.tabs.some((t) => t.id === id)) return { activeTabId: id }
      // The view already exists in the browser, so the tab starts with content.
      // Seed the title from the payload (falling back to the URL's host, then a
      // placeholder); the first browserState push refines it either way.
      const tab: BrowserTab = {
        id,
        kind: 'web',
        title: title || (url ? (hostOf(url) ?? url) : '') || 'Agent tab',
        hasContent: true
      }
      return { tabs: [...state.tabs, tab], activeTabId: id }
    }),

  openDoc: (path) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.kind === 'doc' && t.docPath === path)
      if (existing) return { activeTabId: existing.id }
      const tab = makeDocTab(path)
      return { tabs: [...state.tabs, tab], activeTabId: tab.id }
    }),

  closedTabs: [],

  reopenTab: () =>
    set((state) => {
      const url = state.closedTabs[state.closedTabs.length - 1]
      if (!url) return {}
      const tab = makeTab(url)
      return {
        closedTabs: state.closedTabs.slice(0, -1),
        tabs: [...state.tabs, tab],
        activeTabId: tab.id
      }
    }),

  closeTab: (id) =>
    set((state) => {
      const closing = state.tabs.find((t) => t.id === id)
      if (closing?.kind === 'web' && closing.hasContent) void window.agweb.browser.destroy(id)
      // Remember where the tab was so ⌘⇧T can bring it back. Capped, because
      // this is a convenience, not a history feature.
      const closedUrl = closing?.kind === 'web' ? state.browserStates[id]?.url : undefined
      const closedTabs =
        closedUrl && closedUrl !== 'about:blank'
          ? [...state.closedTabs, closedUrl].slice(-25)
          : state.closedTabs
      const browserStates = { ...state.browserStates }
      delete browserStates[id]

      const tabs = state.tabs.filter((t) => t.id !== id)
      if (tabs.length === 0) {
        const fresh = makeTab()
        return { tabs: [fresh], activeTabId: fresh.id, browserStates, closedTabs, splitTabId: null }
      }
      const activeTabId =
        state.activeTabId === id ? tabs[Math.max(0, tabs.length - 1)].id : state.activeTabId
      // A split needs two distinct live tabs. Collapse it if the companion is
      // the tab being closed, or if the new active tab is the companion —
      // otherwise the stage keeps sizing a pane to a destroyed view.
      const splitTabId =
        state.splitTabId === id || state.splitTabId === activeTabId ? null : state.splitTabId
      return { tabs, activeTabId, browserStates, closedTabs, splitTabId }
    }),

  activateTab: (id) => set({ activeTabId: id }),

  moveTab: (id, beforeId) =>
    set((state) => {
      if (id === beforeId) return {}
      const moving = state.tabs.find((t) => t.id === id)
      if (!moving) return {}
      const rest = state.tabs.filter((t) => t.id !== id)
      const index = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length
      if (index < 0) return {}
      // Chrome-style ungroup-on-drag-out: a grouped tab stays in its group only
      // when it lands adjacent to a fellow member, keeping the run one unbroken
      // segment. Dropped anywhere else it leaves the group, so the strip never
      // renders two chips for a group split into two pieces.
      let placed = moving
      if (moving.groupId) {
        const staysContiguous =
          rest[index - 1]?.groupId === moving.groupId || rest[index]?.groupId === moving.groupId
        if (!staysContiguous) placed = { ...moving, groupId: undefined }
      }
      return { tabs: [...rest.slice(0, index), placed, ...rest.slice(index)] }
    }),

  markTabHasContent: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasContent: true } : t))
    })),

  updateBrowserState: (browserState) => {
    // A link click, or the OS opening a file with WebDeck, commits in the
    // native view without passing through navigateTab. Catching it here is
    // what makes "clicked a .md link" behave like "opened it from Files":
    // the tab becomes a doc tab and the native view is hidden, so the raw
    // text underneath is never shown.
    const store = useShellStore.getState()
    const docPath = docNavTarget(browserState.url, store.workspace?.path ?? null)
    if (docPath) {
      void window.agweb.browser.setVisible(browserState.tabId, false)
      store.openDoc(docPath)
      return
    }
    set((state) => ({
      browserStates: { ...state.browserStates, [browserState.tabId]: browserState },
      tabs: state.tabs.map((tab) => {
        if (tab.id !== browserState.tabId) return tab
        const title = browserState.title || hostOf(browserState.url) || 'New Tab'
        return { ...tab, title, favicon: browserState.favicon, hasContent: true }
      })
    }))
    // Every navigation flows through here, so it is the one place to record
    // history for the omnibox. recordVisit ignores non-web URLs and dedupes.
    if (browserState.url) {
      useShellStore
        .getState()
        .recordVisit(browserState.url, browserState.title, browserState.favicon)
    }
  },

  setOverlayOpen: (open) =>
    set((state) => ({ overlayCount: Math.max(0, state.overlayCount + (open ? 1 : -1)) })),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  snapshotsOpen: false,
  setSnapshotsOpen: (open) => set({ snapshotsOpen: open }),

  readerOpen: false,
  setReaderOpen: (open) => set({ readerOpen: open }),

  toggleDeck: () => set((state) => ({ deckRevealed: !state.deckRevealed })),

  setDeckSizes: (sizes) =>
    set((state) => ({ deckSizes: clampDeckSizes({ ...state.deckSizes, ...sizes }) })),
  toggleDeckCorner: (side) =>
    set((state) => {
      const corners = clampDeckSizes(state.deckSizes).corners!
      const next = corners[side] === 'dock' ? 'column' : 'dock'
      return {
        deckSizes: clampDeckSizes({ ...state.deckSizes, corners: { ...corners, [side]: next } })
      }
    }),

  zoneCapacity: {
    left: UNMEASURED_CAPACITY,
    right: UNMEASURED_CAPACITY,
    bottom: UNMEASURED_CAPACITY
  },
  setZoneCapacity: (zone, capacity) =>
    set((state) => {
      if (state.zoneCapacity[zone] === capacity) return {}
      return {
        zoneCapacity: { ...state.zoneCapacity, [zone]: capacity },
        groups: foldZone(state.groups, zone, capacity)
      }
    }),

  setDockWidths: (widths) =>
    set((state) => ({
      deckSizes: clampDeckSizes({
        ...state.deckSizes,
        dockWidths: { ...state.deckSizes.dockWidths, ...widths }
      })
    })),

  detachDeck: () =>
    set(() => {
      // Detaching hides the inline Deck and asks the host for a window to put
      // it in. Where the host has no second window to give, that trade loses
      // the Deck outright — so stay attached rather than detach into nothing.
      if (!window.agweb.host.canOpenWindows) return { deckRevealed: true }
      return { deckMode: 'detached' as const, deckRevealed: false }
    }),

  attachDeck: () => set({ deckMode: 'attached', deckRevealed: true }),

  activateBlock: (groupId, blockId) =>
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, activeBlockId: blockId } : g))
    })),

  addBlockToGroup: (groupId, type) =>
    set((state) => {
      const block = makeBlock(type)
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups: state.groups.map((g) =>
          g.id === groupId
            ? { ...g, blockIds: [...g.blockIds, block.id], activeBlockId: block.id }
            : g
        )
      }
    }),

  closeBlock: (blockId) =>
    set((state) => {
      if (state.blocks[blockId]?.type === 'terminal') void window.agweb.terminal.dispose(blockId)
      const blocks = { ...state.blocks }
      delete blocks[blockId]
      return {
        blocks,
        groups: withoutBlock(state.groups, blockId),
        rail: state.rail.filter((r) => r.blockId !== blockId)
      }
    }),

  moveBlock: (blockId, target) =>
    set((state) => {
      const source = state.groups.find((g) => g.blockIds.includes(blockId))
      if (!source) return {}
      if (target.kind === 'stack' && target.groupId === source.id) return {}

      let groups = withoutBlock(state.groups, blockId)
      if (target.kind === 'stack') {
        groups = groups.map((g) =>
          g.id === target.groupId
            ? { ...g, blockIds: [...g.blockIds, blockId], activeBlockId: blockId }
            : g
        )
        if (!groups.some((g) => g.blockIds.includes(blockId))) {
          groups = [
            ...groups,
            { ...makeGroup(source.zone, []), blockIds: [blockId], activeBlockId: blockId }
          ]
        }
      } else if (target.kind === 'before') {
        const index = groups.findIndex((g) => g.id === target.groupId)
        const zone = groups[index]?.zone ?? source.zone
        const fresh = { ...makeGroup(zone, []), blockIds: [blockId], activeBlockId: blockId }
        groups = insertGroup(
          groups,
          fresh,
          index < 0 ? groups.length : index,
          capacityOf(state, zone)
        )
      } else if (target.zone === 'floating') {
        groups = [
          ...groups,
          { ...makeGroup('floating', []), blockIds: [blockId], activeBlockId: blockId }
        ]
      } else {
        if (source.blockIds.length === 1 && source.zone === target.zone) return {}
        groups = placeBlock(groups, target.zone, blockId, state.zoneCapacity[target.zone], () =>
          makeGroup(target.zone, [])
        )
      }
      return { groups }
    }),

  moveGroup: (groupId, target) =>
    set((state) => {
      const source = state.groups.find((g) => g.id === groupId)
      if (!source) return {}
      if (target.kind === 'stack') {
        if (target.groupId === groupId) return {}
        const groups = state.groups
          .filter((g) => g.id !== groupId)
          .map((g) =>
            g.id === target.groupId
              ? {
                  ...g,
                  blockIds: [...g.blockIds, ...source.blockIds],
                  activeBlockId: source.activeBlockId
                }
              : g
          )
        return { groups }
      }
      if (target.kind === 'before') {
        if (target.groupId === groupId) return {}
        const rest = state.groups.filter((g) => g.id !== groupId)
        const index = rest.findIndex((g) => g.id === target.groupId)
        if (index < 0) return {}
        const moved = { ...source, zone: rest[index].zone }
        return { groups: insertGroup(rest, moved, index, capacityOf(state, moved.zone)) }
      }
      if (source.zone === target.zone && target.zone !== 'floating') {
        const rest = state.groups.filter((g) => g.id !== groupId)
        return { groups: [...rest, source] }
      }
      if (target.zone === 'floating') {
        return {
          groups: [...state.groups.filter((g) => g.id !== groupId), { ...source, zone: 'floating' }]
        }
      }
      return {
        groups: placeGroup(state.groups, source, target.zone, state.zoneCapacity[target.zone])
      }
    }),

  sendToRail: (blockId) =>
    set((state) => {
      const source = state.groups.find((g) => g.blockIds.includes(blockId))
      if (!source) return {}
      // Remember the real zone (floating included) and the group's position, so a
      // restore returns the block exactly where it was, not appended as 'right' (P3-6).
      return {
        groups: withoutBlock(state.groups, blockId),
        rail: [
          ...state.rail,
          { blockId, prevZone: source.zone, index: state.groups.indexOf(source) }
        ]
      }
    }),

  restoreFromRail: (blockId) =>
    set((state) => {
      const entry = state.rail.find((r) => r.blockId === blockId)
      if (!entry) return {}
      const restored: BlockGroup = {
        ...makeGroup(entry.prevZone, []),
        blockIds: [blockId],
        activeBlockId: blockId
      }
      const at = entry.index ?? state.groups.length
      const groups = insertGroup(state.groups, restored, at, capacityOf(state, restored.zone))
      return { rail: state.rail.filter((r) => r.blockId !== blockId), groups }
    }),

  pendingRevealLine: null,
  clearPendingReveal: () => set({ pendingRevealLine: null }),

  toasts: [],
  pushToast: (message, tone = 'info') =>
    set((state) => ({
      // Cap the stack so a burst of denials can't grow it without bound.
      toasts: [...state.toasts, { id: `toast-${nextToastId++}`, message, tone }].slice(-4)
    })),
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  openFile: (path, line) =>
    set((state) => ({
      editorTabs: state.editorTabs.includes(path) ? state.editorTabs : [...state.editorTabs, path],
      activeEditorPath: path,
      pendingRevealLine: line ?? null,
      deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
    })),

  adoptTerminal: (sessionId, title) =>
    set((state) => {
      if (state.blocks[sessionId]) return { deckRevealed: true }
      const block: BlockInstance = { id: sessionId, type: 'terminal', title: `▸ ${title}` }
      const bottom = state.groups.filter((g) => g.zone === 'bottom')
      // Join the existing bottom group if there is one, so an agent's commands
      // stack as tabs beside the user's own terminals rather than splitting.
      const target = bottom.find((g) =>
        g.blockIds.some((id) => state.blocks[id]?.type === 'terminal')
      )
      const groups = target
        ? state.groups.map((g) =>
            g.id === target.id
              ? { ...g, blockIds: [...g.blockIds, block.id], activeBlockId: block.id }
              : g
          )
        : placeBlock(state.groups, 'bottom', block.id, state.zoneCapacity.bottom, () =>
            makeGroup('bottom', [])
          )
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups,
        deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
      }
    }),

  addBlock: (type, payload, title) =>
    set((state) => {
      // One block per extension view container: re-adding one just focuses it.
      if (type === 'extview' && payload) {
        const existing = Object.values(state.blocks).find(
          (b) => b.type === 'extview' && b.payload?.containerId === payload.containerId
        )
        if (existing) {
          const group = state.groups.find((g) => g.blockIds.includes(existing.id))
          return {
            groups: group
              ? state.groups.map((g) =>
                  g.id === group.id ? { ...g, activeBlockId: existing.id } : g
                )
              : state.groups,
            deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
          }
        }
      }
      const block = makeBlock(type, payload, title)
      const zone: DockZone = type === 'terminal' || type === 'logs' ? 'bottom' : 'right'
      return {
        blocks: { ...state.blocks, [block.id]: block },
        groups: placeBlock(state.groups, zone, block.id, state.zoneCapacity[zone], () =>
          makeGroup(zone, [])
        ),
        deckRevealed: state.deckMode === 'attached' ? true : state.deckRevealed
      }
    }),

  closeEditorTab: (path) =>
    set((state) => {
      const editorTabs = state.editorTabs.filter((p) => p !== path)
      const dirtyFiles = { ...state.dirtyFiles }
      delete dirtyFiles[path]
      const activeEditorPath =
        state.activeEditorPath === path
          ? (editorTabs[editorTabs.length - 1] ?? null)
          : state.activeEditorPath
      return { editorTabs, activeEditorPath, dirtyFiles }
    }),

  setFileDirty: (path, dirty) =>
    set((state) => ({ dirtyFiles: { ...state.dirtyFiles, [path]: dirty } })),

  saveSnapshot: (name) => {
    // Capture whether the write landed outside `set` (zustand setters have no
    // return value) so the caller can report a storage failure to the user.
    let persisted = false
    set((state) => {
      const snapshot: WorkspaceSnapshot = {
        id: `snapshot-${Date.now().toString(36)}-${nextSnapshotId++}`,
        name: name.trim() || `Snapshot ${state.snapshots.length + 1}`,
        workspace: state.workspace,
        savedAt: Date.now(),
        // Reuse the exact serializers the per-workspace autosaves use, so a
        // snapshot captures tabs/groups/layout byte-for-byte the same way.
        tabSession: serializeTabSession(state),
        layout: serializeLayout(state),
        editorTabs: state.editorTabs,
        activeEditorPath: state.activeEditorPath
      }
      const snapshots = [snapshot, ...state.snapshots]
      persisted = saveSnapshots(snapshots)
      return { snapshots }
    })
    return persisted
  },

  restoreSnapshot: (id) =>
    set((state) => {
      const snapshot = state.snapshots.find((s) => s.id === id)
      if (!snapshot) return {}
      // Rebuild through the same paths setWorkspace uses: rebuildLayout bumps
      // the block/group counters, rebuildTabSession re-mints tab and group ids.
      const layout = rebuildLayout(snapshot.layout)
      const session = rebuildTabSession(snapshot.tabSession)
      if (session) {
        // Tear down the live web views the restored strip replaces — exactly
        // what leaving a workspace does — so no orphaned native view lingers.
        for (const tab of state.tabs) {
          if (tab.kind === 'web' && tab.hasContent) void window.agweb.browser.destroy(tab.id)
        }
      }
      return {
        workspace: snapshot.workspace,
        editorTabs: snapshot.editorTabs,
        activeEditorPath: snapshot.activeEditorPath,
        ...(layout ?? {}),
        // Re-minted tab ids replace the strip, so any open split binding is now
        // dangling — reset it (and the divider) alongside the restored session.
        ...(session ? { ...session, browserStates: {}, splitTabId: null, splitRatio: 0.5 } : {})
      }
    }),

  renameSnapshot: (id, name) =>
    set((state) => {
      const trimmed = name.trim()
      const snapshots = state.snapshots.map((s) =>
        s.id === id ? { ...s, name: trimmed || s.name } : s
      )
      saveSnapshots(snapshots)
      return { snapshots }
    }),

  deleteSnapshot: (id) =>
    set((state) => {
      const snapshots = state.snapshots.filter((s) => s.id !== id)
      saveSnapshots(snapshots)
      return { snapshots }
    }),

  applyPreset: (preset) =>
    set((state) => {
      if (preset === 'browsing') return { deckRevealed: false }

      const blocks = { ...state.blocks }
      const ofType = (type: BlockType): BlockInstance[] =>
        Object.values(blocks).filter((b) => b.type === type)
      const need = (type: BlockType): BlockInstance[] => {
        const existing = ofType(type)
        if (existing.length > 0) return existing
        const fresh = makeBlock(type)
        blocks[fresh.id] = fresh
        return [fresh]
      }

      const groups =
        preset === 'building'
          ? [
              makeGroup('right', need('editor')),
              makeGroup('right', need('files')),
              makeGroup('bottom', need('terminal')),
              makeGroup('bottom', need('agents'))
            ]
          : // Debugging is not Building with a logs tab. The file tree moves to
            // the left column, the debugger stands beside the editor on the
            // right, and the bottom dock is the evidence: logs first and on
            // their own, then the terminal, then the agent.
            [
              makeGroup('left', need('files')),
              makeGroup('right', need('editor')),
              makeGroup('right', need('debug')),
              makeGroup('bottom', need('logs')),
              makeGroup('bottom', need('terminal')),
              makeGroup('bottom', need('agents'))
            ]

      // Blocks outside the preset's types (Search, Logs under Building…)
      // must not be orphaned: keep each as its own group in a sensible zone.
      const placed = new Set(groups.flatMap((g) => g.blockIds))
      for (const block of Object.values(blocks)) {
        if (placed.has(block.id)) continue
        const zone: DeckZone =
          block.type === 'terminal' || block.type === 'logs' ? 'bottom' : 'right'
        groups.push({ ...makeGroup(zone, []), blockIds: [block.id], activeBlockId: block.id })
      }

      return { blocks, groups, rail: [], deckRevealed: true }
    })
}))

/* ---- One surface at a time ---- */

// The Deck has priority over the Ask panel in the same window: whenever an
// attached Deck comes forward — ⌘D, a preset, a file opening into the editor,
// a restore — the panel closes. A detached Deck lives in its own window and
// the two coexist. openAssistant handles the other direction.
useShellStore.subscribe((state) => {
  if (state.assistantOpen && state.deckMode === 'attached' && state.deckRevealed) {
    useShellStore.setState({ assistantOpen: false })
  }
})

/* ---- Cross-window sync + persistence ---- */

let applyingRemote = false

/** Apply a layout slice broadcast by another shell window. */
export function applyRemoteState(state: DeckSyncState): void {
  applyingRemote = true
  try {
    useShellStore.setState(state)
  } finally {
    applyingRemote = false
  }
}

export function currentSyncState(): DeckSyncState {
  const s = useShellStore.getState()
  return {
    blocks: s.blocks,
    groups: s.groups,
    rail: s.rail,
    deckMode: s.deckMode,
    deckSizes: s.deckSizes,
    editorTabs: s.editorTabs,
    activeEditorPath: s.activeEditorPath
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
// Seed with the boot state so unrelated changes (workspace, tabs, theme)
// never broadcast — a fresh window broadcasting its stale persisted layout
// would clobber the live state in every other window.
let lastSlice: DeckSyncState = currentSyncState()
useShellStore.subscribe((state) => {
  const changed =
    lastSlice.blocks !== state.blocks ||
    lastSlice.groups !== state.groups ||
    lastSlice.rail !== state.rail ||
    lastSlice.deckMode !== state.deckMode ||
    lastSlice.deckSizes !== state.deckSizes ||
    lastSlice.editorTabs !== state.editorTabs ||
    lastSlice.activeEditorPath !== state.activeEditorPath
  if (!changed) return
  lastSlice = {
    blocks: state.blocks,
    groups: state.groups,
    rail: state.rail,
    deckMode: state.deckMode,
    deckSizes: state.deckSizes,
    editorTabs: state.editorTabs,
    activeEditorPath: state.activeEditorPath
  }
  // Only meaningful when the host can open other windows; on the fork there is
  // nothing to sync to, and firing it rejected on every single state change.
  if (!applyingRemote && window.agweb.host.canOpenWindows) {
    void window.agweb.windows.broadcastState(lastSlice)
  }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveLayout(useShellStore.getState()), 400)
})

// Tab sessions persist per workspace (main window only). Titles and urls are
// saved so a restored strip renders instantly; pages lazy-load on activation.
if (isLayoutAuthority) {
  let lastTabSlice = {
    tabs: useShellStore.getState().tabs,
    activeTabId: useShellStore.getState().activeTabId,
    browserStates: useShellStore.getState().browserStates,
    tabGroups: useShellStore.getState().tabGroups
  }
  let tabSaveTimer: ReturnType<typeof setTimeout> | null = null
  useShellStore.subscribe((state) => {
    const changed =
      lastTabSlice.tabs !== state.tabs ||
      lastTabSlice.activeTabId !== state.activeTabId ||
      lastTabSlice.browserStates !== state.browserStates ||
      lastTabSlice.tabGroups !== state.tabGroups
    if (!changed) return
    lastTabSlice = {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      browserStates: state.browserStates,
      tabGroups: state.tabGroups
    }
    if (tabSaveTimer) clearTimeout(tabSaveTimer)
    tabSaveTimer = setTimeout(() => saveTabSession(useShellStore.getState()), 400)
  })
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}
