import { Fragment, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { DeckSizes } from '@shared/deck'
import {
  useShellStore,
  type BlockGroup,
  type BlockInstance,
  type DeckZone,
  type DropTarget,
  effectiveLeftWidth
} from '@/store'
import { BlockTypeIcon, CloseIcon, GripIcon, MinusIcon, PopOutIcon } from '@/components/icons'
import { capacityFor } from '@/deck-capacity'
import { BlockContent } from '@/components/BlockContent'

/**
 * The Dev Deck: docked zones of tabbed block groups plus the rail.
 * Drag a tab to move one block; drag a group's grip to move the stack.
 * Drop on a header = stack into that group; on a group's body = insert
 * before it; on a zone's empty space = append to that zone.
 */

const DRAG_MIME = 'application/x-agweb-drag'

interface DragPayload {
  kind: 'block' | 'group'
  id: string
}

/**
 * Begin a drag, showing the block's own header as the drag image.
 *
 * The browser's default preview is whatever element was grabbed — a tab label
 * or the grip glyph — which makes it look like a word is being dragged rather
 * than a block. A header-shaped ghost makes the thing being moved obvious.
 */
function startDrag(event: DragEvent, payload: DragPayload, label: string): void {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'move'

  // Open the drop zones for the duration of the drag. `dragend` fires on the
  // source whether the drag was dropped or abandoned, so it is the one signal
  // that always arrives — a drop handler alone would leave the zones open when
  // someone drags out of the window and lets go.
  useShellStore.getState().setBlockDragging(true)
  window.addEventListener('dragend', () => useShellStore.getState().setBlockDragging(false), {
    once: true
  })

  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  // The grip, so the ghost reads as the same header the block wears.
  const grip = document.createElement('span')
  grip.textContent = '⠿'
  grip.style.opacity = '0.5'
  ghost.append(grip, document.createTextNode(label))
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 16, 17)
  // Removed on the next frame: it must survive the snapshot the browser takes
  // synchronously, but must not linger in the DOM.
  requestAnimationFrame(() => ghost.remove())
}

function readDrag(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_MIME)
    return raw ? (JSON.parse(raw) as DragPayload) : null
  } catch {
    return null
  }
}

function useDropZone(onDrop: (payload: DragPayload) => void): {
  over: boolean
  handlers: {
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
} {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const payload = readDrag(e)
        if (payload) onDrop(payload)
      }
    }
  }
}

function dropTo(payload: DragPayload, target: DropTarget): void {
  const { moveBlock, moveGroup } = useShellStore.getState()
  if (payload.kind === 'block') moveBlock(payload.id, target)
  else moveGroup(payload.id, target)
}

export function Deck(): React.JSX.Element {
  const groups = useShellStore((s) => s.groups)
  const left = groups.filter((g) => g.zone === 'left')
  const right = groups.filter((g) => g.zone === 'right')
  const bottom = groups.filter((g) => g.zone === 'bottom')

  return (
    <>
      <ZoneView zone="left" className="deck-left" groups={left} />
      <ZoneView zone="right" className="deck-col" groups={right} />
      <ZoneView zone="bottom" className="deck-dock" groups={bottom} />
      {left.length > 0 && <ResizeHandle axis="left" />}
      <ResizeHandle axis="col" />
      {bottom.length > 0 && <ResizeHandle axis="dock" />}
      {bottom.length > 0 && left.length > 0 && <CornerToggle side="left" />}
      {bottom.length > 0 && right.length > 0 && <CornerToggle side="right" />}
      <Rail />
    </>
  )
}

/**
 * The corner where a side column meets the bottom dock has two owners to
 * choose from: the dock runs the full width under the column, or the column
 * stands full height beside the dock. One click at the junction flips it,
 * per side, so a tall file tree and a wide log can coexist.
 */
function CornerToggle({ side }: { side: 'left' | 'right' }): React.JSX.Element {
  const owner = useShellStore((s) => s.deckSizes.corners?.[side] ?? 'dock')
  const toggle = useShellStore((s) => s.toggleDeckCorner)
  const column = side === 'left' ? 'left column' : 'right column'
  const label =
    owner === 'dock'
      ? `Let the ${column} run full height beside the dock`
      : `Let the bottom dock run the full width under the ${column}`
  return (
    <button
      type="button"
      className={`deck-corner deck-corner-${side} deck-corner-${owner}`}
      onClick={() => toggle(side)}
      aria-label={label}
      title={label}
      data-testid={`deck-corner-${side}`}
    >
      <span aria-hidden="true">{owner === 'dock' ? (side === 'left' ? '⌞' : '⌟') : '│'}</span>
    </button>
  )
}

/** Edge resize (2B.3): drag the gutter between the stage and a deck zone.
 *  Sizes stream into the store, so the native view tracks via its
 *  ResizeObserver exactly like the reveal animation. */
function ResizeHandle({ axis }: { axis: 'col' | 'dock' | 'left' }): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  // Detaching the listeners is owned by an effect, not by the pointerup
  // handler: a drag can end without pointerup (capture lost, the deck
  // detaching mid-drag), which would otherwise leave `move` bound to window
  // forever, resizing on every later mouse move.
  const dragRef = useRef<{ start: { x: number; y: number }; initial: DeckSizes } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const setDeckSizes = useShellStore.getState().setDeckSizes
      if (axis === 'col') {
        setDeckSizes({ colWidth: drag.initial.colWidth + (drag.start.x - e.clientX) })
      } else if (axis === 'left') {
        // The left column grows the other way: rightward drag widens it. From
        // the width on screen — a column opened by a drop may still be 0 in
        // the store while it shows at the default width.
        setDeckSizes({
          leftWidth: effectiveLeftWidth(drag.initial) + (e.clientX - drag.start.x)
        })
      } else {
        setDeckSizes({ dockHeight: drag.initial.dockHeight + (drag.start.y - e.clientY) })
      }
    }
    const end = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragRef.current = null
    }
  }, [dragging, axis])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragRef.current = {
      start: { x: event.clientX, y: event.clientY },
      initial: useShellStore.getState().deckSizes
    }
    setDragging(true)
  }

  return (
    <div
      className={`deck-resize deck-resize-${axis} ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={axis === 'dock' ? 'horizontal' : 'vertical'}
      aria-label={
        axis === 'col'
          ? 'Resize deck column'
          : axis === 'left'
            ? 'Resize left column'
            : 'Resize deck dock'
      }
    />
  )
}

function ZoneView({
  zone,
  className,
  groups
}: {
  zone: DeckZone
  className: string
  groups: BlockGroup[]
}): React.JSX.Element {
  const { over, handlers } = useDropZone((payload) => dropTo(payload, { kind: 'zone', zone }))
  const dockWidths = useShellStore((s) => s.deckSizes.dockWidths)

  // A zone holding exactly one block used to stay dark while zero- and
  // two-block zones lit up: the single group grows to fill the zone and its
  // own drop handler calls stopPropagation, so the zone's bubble-phase
  // handler never ran. Watching the capture phase as well means the zone
  // answers a drag the same way whatever it already contains — the group
  // still decides where the block actually lands.
  const [nearby, setNearby] = useState(false)
  const zoneRef = useRef<HTMLDivElement>(null)

  // Measure how many groups fit at the minimum group size and tell the store,
  // so a block beyond that becomes a tab instead of a clipped third stack, and
  // a resize folds stacks together rather than hiding one behind another.
  useEffect(() => {
    const el = zoneRef.current
    if (!el || zone === 'floating') return
    const measure = (): void => {
      const style = getComputedStyle(el)
      const px = (v: string): number => parseFloat(v) || 0
      const gap = px(style.gap)
      const along = zone === 'bottom' ? el.clientWidth : el.clientHeight
      const min = px(
        style.getPropertyValue(zone === 'bottom' ? '--deck-group-min-w' : '--deck-group-min-h')
      )
      // A zone mid-animation or hidden reports nothing useful; keep the last value.
      if (along < min) return
      useShellStore.getState().setZoneCapacity(zone, capacityFor(along, min, gap))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [zone])
  const captureHandlers = {
    onDragOverCapture: (e: DragEvent): void => {
      if (e.dataTransfer.types.includes(DRAG_MIME)) setNearby(true)
    },
    onDragLeaveCapture: (e: DragEvent): void => {
      // Crossing between children fires dragleave too; only a pointer that
      // has actually left the zone counts.
      const to = e.relatedTarget
      if (!(to instanceof Node) || !zoneRef.current?.contains(to)) setNearby(false)
    },
    onDropCapture: (): void => setNearby(false),
    onDragEndCapture: (): void => setNearby(false)
  }

  return (
    <div
      ref={zoneRef}
      className={`${className} ${over || nearby ? 'rounded-xl ring-2 ring-sky-500/50' : ''}`}
      {...captureHandlers}
      {...handlers}
    >
      {groups.map((group, i) => (
        <Fragment key={group.id}>
          {/* Every boundary in the dock is draggable, so any block can be
              resized — not only the first, which used to be the sole grower
              with the rest pinned at 330px. */}
          {zone === 'bottom' && i > 0 && (
            <DockSplitter leftId={groups[i - 1].id} rightId={group.id} />
          )}
          <GroupView
            group={group}
            grow={zone !== 'bottom' || dockWidths[group.id] === undefined}
            fixedWidth={zone === 'bottom' ? dockWidths[group.id] : undefined}
          />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * A draggable boundary between two bottom-dock blocks.
 *
 * Dragging pins both neighbours to explicit widths: until a boundary is
 * touched the blocks share the dock, and pinning only the one being dragged
 * would let the other silently absorb every later change.
 */
function DockSplitter({ leftId, rightId }: { leftId: string; rightId: string }): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; left: number; right: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const delta = e.clientX - drag.x
      useShellStore.getState().setDockWidths({
        [leftId]: drag.left + delta,
        [rightId]: drag.right - delta
      })
    }
    const end = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragRef.current = null
    }
  }, [dragging, leftId, rightId])

  return (
    <div
      className={`dock-splitter ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize blocks"
      onPointerDown={(event) => {
        event.preventDefault()
        // Measure what is on screen now, so the first drag from "shared"
        // widths starts exactly where the blocks already are.
        const measure = (id: string): number =>
          document.querySelector<HTMLElement>(`[data-deck-header="${id}"]`)?.parentElement
            ?.offsetWidth ?? 330
        dragRef.current = { x: event.clientX, left: measure(leftId), right: measure(rightId) }
        setDragging(true)
      }}
    />
  )
}

export function GroupView({
  group,
  grow,
  fixedWidth
}: {
  group: BlockGroup
  grow?: boolean
  fixedWidth?: number
}): React.JSX.Element {
  const blocks = useShellStore((s) => s.blocks)
  const activateBlock = useShellStore((s) => s.activateBlock)
  const addBlockToGroup = useShellStore((s) => s.addBlockToGroup)
  const closeBlock = useShellStore((s) => s.closeBlock)
  const sendToRail = useShellStore((s) => s.sendToRail)
  const moveGroup = useShellStore((s) => s.moveGroup)
  const activeEditorPath = useShellStore((s) => s.activeEditorPath)
  const members = group.blockIds.map((id) => blocks[id]).filter(Boolean) as BlockInstance[]
  const active = blocks[group.activeBlockId] ?? members[0]

  const header = useDropZone((payload) => dropTo(payload, { kind: 'stack', groupId: group.id }))
  const body = useDropZone((payload) => dropTo(payload, { kind: 'before', groupId: group.id }))

  return (
    <div
      className={`deck-group flex min-h-0 flex-col overflow-hidden rounded-[10px] border bg-white dark:bg-[#0e1420] ${
        body.over
          ? 'border-sky-500 ring-2 ring-sky-500/40'
          : 'border-slate-200 dark:border-slate-800'
      }`}
      style={{
        flex: grow ? 1 : undefined,
        width: fixedWidth,
        flexShrink: fixedWidth ? 0 : undefined
      }}
      {...body.handlers}
    >
      <div
        data-deck-header={group.id}
        className={`flex h-[34px] flex-none items-center gap-1 border-b px-2.5 ${
          header.over ? 'border-sky-500 bg-sky-500/10' : 'border-slate-200 dark:border-slate-800'
        }`}
        {...header.handlers}
      >
        <span
          draggable
          onDragStart={(e) =>
            startDrag(e, { kind: 'group', id: group.id }, active?.title ?? 'Block')
          }
          className="mr-1 shrink-0 cursor-grab text-slate-400 dark:text-slate-600"
          title="Drag to move this stack"
        >
          <GripIcon />
        </span>
        {members.map((block) => (
          <button
            key={block.id}
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'block', id: block.id }, block.title)}
            onClick={() => activateBlock(group.id, block.id)}
            className={`flex h-full cursor-grab items-center px-2.5 text-[11px] font-bold uppercase tracking-wider ${
              block.id === active?.id
                ? 'border-b-2 border-sky-500 text-slate-700 dark:text-slate-200'
                : 'font-semibold text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
            }`}
          >
            {block.title}
          </button>
        ))}
        {active && (
          <button
            onClick={() => addBlockToGroup(group.id, active.type)}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
            aria-label={`New ${active.type}`}
          >
            +
          </button>
        )}
        {active?.type === 'editor' && activeEditorPath && (
          // The header's context string: identity (the tab) + what it's on (P3-5).
          <span
            className="ml-1 max-w-[45%] truncate text-[11px] font-normal normal-case text-slate-400 dark:text-slate-500"
            title={activeEditorPath}
          >
            {activeEditorPath.split('/').pop()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-slate-400 dark:text-slate-600">
          {active && (
            <button
              onClick={() => moveGroup(group.id, { kind: 'zone', zone: 'floating' })}
              className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={`Float ${active.title}`}
              title="Float this stack in its own window"
            >
              <PopOutIcon />
            </button>
          )}
          {active && (
            <>
              <button
                onClick={() => sendToRail(active.id)}
                className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label={`Send ${active.title} to rail`}
              >
                <MinusIcon />
              </button>
              <button
                onClick={() => closeBlock(active.id)}
                className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label={`Close ${active.title}`}
              >
                <CloseIcon />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{active && <BlockContent block={active} />}</div>
    </div>
  )
}

function Rail(): React.JSX.Element | null {
  const rail = useShellStore((s) => s.rail)
  const blocks = useShellStore((s) => s.blocks)
  const restoreFromRail = useShellStore((s) => s.restoreFromRail)

  if (rail.length === 0) return null
  return (
    <div className="deck-rail">
      {rail.map((entry) => {
        const block = blocks[entry.blockId]
        if (!block) return null
        return (
          <button
            key={entry.blockId}
            onClick={() => restoreFromRail(entry.blockId)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-sky-500 hover:text-sky-500 dark:border-slate-800 dark:bg-[#0e1420] dark:text-slate-400"
            aria-label={`Restore ${block.title}`}
            title={block.title}
          >
            <BlockTypeIcon type={block.type} />
          </button>
        )
      })}
    </div>
  )
}
