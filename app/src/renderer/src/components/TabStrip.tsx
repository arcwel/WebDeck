import { Fragment, useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
  TAB_GROUP_COLORS,
  useShellStore,
  type BrowserTab,
  type TabGroup,
  type TabGroupColor
} from '@/store'
import { BlockTypeIcon, CloseIcon, DocIcon, GlobeIcon } from '@/components/icons'
import { usePopover } from '@/popover'
import { AnchoredPopover } from '@/components/AnchoredPopover'

/**
 * Tab strip with drag-to-reorder and Chrome-style tab groups, in two layouts.
 *
 * **Horizontal** is the default title-bar strip: tabs **shrink to fit** rather
 * than running off the window — a strip you cannot see the end of is a strip
 * you cannot use. **Vertical** is a left rail: each tab is a full-width row with
 * favicon + truncated title, which reads better when many tabs are open. The
 * layout is a store flag so the surrounding Stage/App can reserve rail width.
 *
 * Either way a group's tabs are kept adjacent, so a group is always a contiguous
 * run that can be collapsed to a single chip.
 */

type Orientation = 'horizontal' | 'vertical'

const TAB_DRAG_MIME = 'application/x-agweb-tab'

/** Toggle glyph: two stacked bars (rail) vs. a wide bar (strip). */
function LayoutIcon({
  vertical,
  size = 14
}: {
  vertical: boolean
  size?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      {vertical ? (
        <>
          <rect x="3" y="3" width="7" height="18" rx="1.5" />
          <rect x="13" y="3" width="8" height="18" rx="1.5" />
        </>
      ) : (
        <>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
        </>
      )}
    </svg>
  )
}

export function TabStrip(): React.JSX.Element {
  // Per-field selectors: subscribing to the whole store re-renders the strip
  // on every unrelated mutation (agent logs, browser state, dirty flags).
  const tabs = useShellStore((s) => s.tabs)
  const activeTabId = useShellStore((s) => s.activeTabId)
  const activateTab = useShellStore((s) => s.activateTab)
  const closeTab = useShellStore((s) => s.closeTab)
  const moveTab = useShellStore((s) => s.moveTab)
  const newTab = useShellStore((s) => s.newTab)
  const tabGroups = useShellStore((s) => s.tabGroups)
  const groupTabs = useShellStore((s) => s.groupTabs)
  const addTabToGroup = useShellStore((s) => s.addTabToGroup)
  const ungroupTab = useShellStore((s) => s.ungroupTab)
  const verticalTabs = useShellStore((s) => s.verticalTabs)
  const toggleVerticalTabs = useShellStore((s) => s.toggleVerticalTabs)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const orientation: Orientation = verticalTabs ? 'vertical' : 'horizontal'

  const acceptDrag = (event: DragEvent, target: string | null): void => {
    if (!event.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }

  const finishDrop = (event: DragEvent, beforeId: string | null): void => {
    event.preventDefault()
    setDropTarget(null)
    const id = event.dataTransfer.getData(TAB_DRAG_MIME)
    if (id) moveTab(id, beforeId)
  }

  const groupList = Object.values(tabGroups)

  const items = tabs.map((tab, index) => {
    const group = tab.groupId ? tabGroups[tab.groupId] : undefined
    // The chip renders once, at the start of each contiguous group run.
    const startsGroup = group !== undefined && tabs[index - 1]?.groupId !== tab.groupId
    const memberCount = group ? tabs.filter((t) => t.groupId === group.id).length : 0

    return (
      <Fragment key={tab.id}>
        {startsGroup && group && (
          <GroupChip group={group} count={memberCount} orientation={orientation} />
        )}
        {group?.collapsed ? null : (
          <TabItem
            tab={tab}
            group={group}
            orientation={orientation}
            active={tab.id === activeTabId}
            isDropTarget={dropTarget === tab.id}
            menuOpen={menuFor === tab.id}
            groups={groupList}
            onActivate={() => activateTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onOpenMenu={() => setMenuFor(menuFor === tab.id ? null : tab.id)}
            onCloseMenu={() => setMenuFor(null)}
            onDragStartTab={(event) => {
              event.dataTransfer.setData(TAB_DRAG_MIME, tab.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragOverTab={(event) => {
              event.stopPropagation()
              acceptDrag(event, tab.id)
            }}
            onDropTab={(event) => {
              event.stopPropagation()
              finishDrop(event, tab.id)
            }}
            onGroup={() => groupTabs([tab.id])}
            onAddToGroup={(groupId) => addTabToGroup(tab.id, groupId)}
            onUngroup={() => ungroupTab(tab.id)}
          />
        )}
      </Fragment>
    )
  })

  const toggleButton = (
    <button
      onClick={() => toggleVerticalTabs()}
      className="wd-icon no-drag shrink-0"
      style={{ width: 26, height: 26 }}
      aria-label={verticalTabs ? 'Switch to horizontal tabs' : 'Switch to vertical tabs'}
      title={verticalTabs ? 'Horizontal tabs' : 'Vertical tabs'}
    >
      <LayoutIcon vertical={verticalTabs} />
    </button>
  )

  const newTabButton = (
    <button
      onClick={() => newTab()}
      className="wd-icon no-drag shrink-0"
      style={{ width: 26, height: 26 }}
      aria-label="New tab"
    >
      +
    </button>
  )

  if (orientation === 'vertical') {
    // A rail BLOCK: glass, its own header, docked to the stage's left edge by
    // App.tsx / styles.css (.tab-rail-block). Same tabs, groups and drag
    // reorder as the horizontal strip — one tab model, two views of it.
    return (
      <nav
        data-testid="tab-strip"
        aria-label="Tabs"
        data-layout="vertical"
        className="tab-rail-block glass no-drag flex min-h-0 flex-col overflow-hidden rounded-[var(--wd-r-stage)]"
      >
        <div className="flex flex-none items-center gap-1 border-b border-[var(--wd-glass-border)] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--wd-muted)]">
            Tabs
          </span>
          <span className="text-[10px] text-[var(--wd-muted)]" data-testid="tab-rail-count">
            · {tabs.length}
          </span>
          <span className="flex-1" />
          {toggleButton}
          {newTabButton}
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]"
          onDragOver={(event) => acceptDrag(event, 'end')}
          onDrop={(event) => finishDrop(event, null)}
          onDragLeave={() => setDropTarget(null)}
        >
          {items}
        </div>
      </nav>
    )
  }

  return (
    <div
      data-testid="tab-strip"
      data-layout="horizontal"
      className="drag-region flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // Fixed row height: the browser makes the window's title bar exactly this
      // tall (browser_native_widget_mac.mm, kWebDeckTabRowHeight) so the native
      // traffic lights are centred on the tabs. Change both or neither.
      style={{ paddingLeft: 'var(--wd-titlebar-inset)', height: 'var(--wd-tabrow-h)' }}
      onDragOver={(event) => acceptDrag(event, 'end')}
      onDrop={(event) => finishDrop(event, null)}
      onDragLeave={() => setDropTarget(null)}
    >
      {items}
      {toggleButton}
      {newTabButton}
    </div>
  )
}

/** One tab, in either layout. Drag wiring is passed down so both modes reuse
 *  the strip's single reorder mechanism. */
function TabItem({
  tab,
  group,
  orientation,
  active,
  isDropTarget,
  menuOpen,
  groups,
  onActivate,
  onClose,
  onOpenMenu,
  onCloseMenu,
  onDragStartTab,
  onDragOverTab,
  onDropTab,
  onGroup,
  onAddToGroup,
  onUngroup
}: {
  tab: BrowserTab
  group: TabGroup | undefined
  orientation: Orientation
  active: boolean
  isDropTarget: boolean
  menuOpen: boolean
  groups: TabGroup[]
  onActivate: () => void
  onClose: () => void
  onOpenMenu: () => void
  onCloseMenu: () => void
  onDragStartTab: (event: DragEvent) => void
  onDragOverTab: (event: DragEvent) => void
  onDropTab: (event: DragEvent) => void
  onGroup: () => void
  onAddToGroup: (groupId: string) => void
  onUngroup: () => void
}): React.JSX.Element {
  const vertical = orientation === 'vertical'

  const base =
    'no-drag group relative flex cursor-pointer items-center gap-2 overflow-hidden text-[12.5px] transition-colors'
  const shape = vertical ? 'w-full px-3 py-2' : 'min-w-[46px] shrink basis-52 px-3 py-1.5'
  const activeCls = active
    ? 'bg-[rgba(255,255,255,0.1)] text-[var(--wd-text)] ring-1 ring-[var(--wd-glass-border)]'
    : 'text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]'
  // The drop indicator sits on the leading edge: left in a horizontal strip,
  // top in a vertical rail.
  const dropCls = isDropTarget
    ? vertical
      ? 'shadow-[inset_0_2px_0_0_var(--wd-accent)]'
      : 'shadow-[inset_2px_0_0_0_var(--wd-accent)]'
    : ''

  return (
    <div
      draggable
      title={tab.title}
      onDragStart={onDragStartTab}
      onDragOver={onDragOverTab}
      onDrop={onDropTab}
      onClick={onActivate}
      onContextMenu={(event) => {
        event.preventDefault()
        onOpenMenu()
      }}
      style={{ borderRadius: 'var(--wd-r-pill)' }}
      className={`${base} ${shape} ${activeCls} ${dropCls}`}
    >
      {/* A group's colour marks its tabs, so the run reads as one thing even
          when the chip is scrolled away: along the top in a strip, down the
          leading edge in a rail. */}
      {group && (
        <span
          className={`absolute ${
            vertical ? 'inset-y-0 left-0 w-[3px]' : 'inset-x-0 top-0 h-[3px]'
          } ${TAB_GROUP_COLORS[group.color].dot}`}
        />
      )}
      {tab.kind === 'doc' ? (
        <DocIcon
          size={13}
          className={`shrink-0 ${active ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'}`}
        />
      ) : tab.kind === 'editors' ? (
        <BlockTypeIcon
          type="editor"
          size={13}
          className={`shrink-0 ${active ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'}`}
        />
      ) : tab.favicon ? (
        <img
          src={tab.favicon}
          alt=""
          className="h-[13px] w-[13px] shrink-0 rounded-[2px] object-contain"
        />
      ) : (
        <GlobeIcon
          size={13}
          className={`shrink-0 ${active ? 'text-[var(--wd-accent)]' : 'text-[var(--wd-dim)]'}`}
        />
      )}
      {/* flex-1 so the title fills the tab and the close button is always
          pinned to the far edge, not tucked after a short title. */}
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <button
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        className={`ml-auto shrink-0 rounded p-0.5 text-[var(--wd-dim)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)] ${
          vertical ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'
        }`}
        aria-label={`Close ${tab.title}`}
      >
        <CloseIcon size={11} />
      </button>

      {menuOpen && (
        <TabMenu
          orientation={orientation}
          onClose={onCloseMenu}
          inGroup={Boolean(group)}
          currentGroupId={group?.id}
          groups={groups}
          onGroup={onGroup}
          onAddToGroup={onAddToGroup}
          onUngroup={onUngroup}
          onCloseTab={onClose}
        />
      )}
    </div>
  )
}

/** A group's label: click to collapse, ⋯ to rename, recolour or ungroup. */
function GroupChip({
  group,
  count,
  orientation
}: {
  group: TabGroup
  count: number
  orientation: Orientation
}): React.JSX.Element {
  const toggleTabGroup = useShellStore((s) => s.toggleTabGroup)
  const renameTabGroup = useShellStore((s) => s.renameTabGroup)
  const setTabGroupColor = useShellStore((s) => s.setTabGroupColor)
  const removeTabGroup = useShellStore((s) => s.removeTabGroup)
  const newTab = useShellStore((s) => s.newTab)
  const addTabToGroup = useShellStore((s) => s.addTabToGroup)
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  // Portalled: the horizontal strip is overflow-y-hidden, so a menu positioned
  // inside it was clipped to a sliver — Rename was there and unreachable.
  const panelRef = useRef<HTMLDivElement>(null)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), []),
    panelRef
  )
  const colors = TAB_GROUP_COLORS[group.color]
  const vertical = orientation === 'vertical'

  return (
    <div
      ref={ref}
      className={`relative flex shrink-0 items-center ${vertical ? 'w-full px-1 pt-1' : 'mb-1'}`}
    >
      {renaming !== null ? (
        <input
          autoFocus
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => setRenaming(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              renameTabGroup(group.id, renaming.trim() || group.name)
              setRenaming(null)
            }
            if (e.key === 'Escape') setRenaming(null)
          }}
          className={`h-6 rounded-md px-2 text-[11px] font-semibold outline-none ${
            vertical ? 'flex-1' : 'w-24'
          } ${colors.chip}`}
        />
      ) : (
        <button
          onClick={() => toggleTabGroup(group.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
          className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold ${
            vertical ? 'min-w-0 flex-1' : ''
          } ${colors.chip}`}
          title={`${group.name} — click to ${group.collapsed ? 'expand' : 'collapse'}`}
          data-testid="tab-group-chip"
        >
          <span
            className={`transition-transform ${group.collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          >
            ›
          </span>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${colors.dot}`} />
          <span className="min-w-0 truncate">{group.name}</span>
          {group.collapsed && <span className="opacity-60">{count}</span>}
        </button>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="px-1 text-[11px] text-slate-400 hover:text-slate-600"
        aria-label={`${group.name} options`}
      >
        ⋯
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={ref}
          panelRef={panelRef}
          placement="below"
          align="start"
          width={188}
          className="rounded-lg border border-slate-200 bg-white py-1 text-[11px] shadow-xl dark:border-slate-700 dark:bg-[#0e1420]"
          data-testid="tab-group-menu"
          role="menu"
        >
          <button
            onClick={() => {
              setOpen(false)
              setRenaming(group.name)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            data-testid="tab-group-rename"
          >
            Rename
          </button>
          {/* Chrome's "New tab in group". Without it a group could only ever
              grow by dragging an existing tab into it. */}
          <button
            onClick={() => {
              setOpen(false)
              addTabToGroup(newTab(), group.id)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            data-testid="tab-group-new-tab"
          >
            New tab in this group
          </button>
          <div className="flex gap-1 px-3 py-1.5">
            {(Object.keys(TAB_GROUP_COLORS) as TabGroupColor[]).map((color) => (
              <button
                key={color}
                onClick={() => setTabGroupColor(group.id, color)}
                className={`h-4 w-4 rounded-full ${TAB_GROUP_COLORS[color].dot} ${
                  color === group.color ? 'ring-2 ring-slate-400 ring-offset-1' : ''
                }`}
                aria-label={color}
              />
            ))}
          </div>
          <button
            onClick={() => {
              setOpen(false)
              removeTabGroup(group.id)
            }}
            className="block w-full px-3 py-1.5 text-left text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Ungroup all
          </button>
        </AnchoredPopover>
      )}
    </div>
  )
}

/** Right-click menu on a tab. */
function TabMenu({
  orientation,
  onClose,
  inGroup,
  currentGroupId,
  groups,
  onGroup,
  onAddToGroup,
  onUngroup,
  onCloseTab
}: {
  orientation: Orientation
  onClose: () => void
  inGroup: boolean
  currentGroupId: string | undefined
  groups: TabGroup[]
  onGroup: () => void
  onAddToGroup: (groupId: string) => void
  onUngroup: () => void
  onCloseTab: () => void
}): React.JSX.Element {
  // The tab row is `overflow-hidden` (it clips its own title) and the rail is
  // too, so a menu positioned inside either was cut off: invisible in the
  // rail, a sliver in the strip. It is portalled instead and anchored to the
  // row through a zero-size span that covers it. Opens below the row in both
  // orientations (beside it in the rail would sit over the page).
  const anchorRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const ref = usePopover(true, onClose, panelRef)
  const item =
    'block w-full px-3 py-1.5 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800'
  const otherGroups = groups.filter((g) => g.id !== currentGroupId)

  return (
    <div ref={ref} className="contents" data-orientation={orientation}>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-0" />
      <AnchoredPopover
        anchorRef={anchorRef}
        panelRef={panelRef}
        placement="below"
        align="start"
        width={176}
        className="rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-[#0e1420]"
        data-testid="tab-menu"
        role="menu"
      >
        {/* A click in the menu must not reach the tab row's onClick (activate)
          through React's tree, portal or not. */}
        <div onClick={(e) => e.stopPropagation()}>
          {inGroup ? (
            <button
              className={item}
              onClick={() => {
                onUngroup()
                onClose()
              }}
            >
              Remove from group
            </button>
          ) : (
            <button
              className={item}
              onClick={() => {
                onGroup()
                onClose()
              }}
            >
              Add to new group
            </button>
          )}
          {otherGroups.length > 0 && (
            <>
              <div className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700" />
              {otherGroups.map((g) => (
                <button
                  key={g.id}
                  className={`${item} flex items-center gap-2`}
                  onClick={() => {
                    onAddToGroup(g.id)
                    onClose()
                  }}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TAB_GROUP_COLORS[g.color].dot}`}
                  />
                  <span className="min-w-0 truncate">Add to {g.name}</span>
                </button>
              ))}
            </>
          )}
          <div className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700" />
          <button
            className={`${item} text-rose-500`}
            onClick={() => {
              onCloseTab()
              onClose()
            }}
          >
            Close tab
          </button>
        </div>
      </AnchoredPopover>
    </div>
  )
}

export type { BrowserTab }
