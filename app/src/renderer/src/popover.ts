import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useShellStore } from '@/store'
import { coversStage, STAGE_SELECTOR } from '@/stage-overlap'

/**
 * Shared behavior for toolbar/block popovers:
 *  - registers an overlay — but only while the menu actually lies over the
 *    stage. The native WebContentsView paints above the renderer DOM, so a
 *    menu that overlaps the page can only show once the stage hides the view
 *    (which then shows a still of the page in its place, see Stage.tsx). A
 *    menu that stays inside its block or the dock never touches the page, so
 *    the page stays live and untouched;
 *  - closes on Escape and on a pointer press outside the menu.
 *
 * Returns a ref to attach to the popover's outermost element (trigger +
 * panel), so clicking the trigger itself doesn't count as "outside".
 */
export function usePopover(
  open: boolean,
  onClose: () => void,
  /** A panel rendered elsewhere (an `AnchoredPopover` portal) that also counts
   *  as inside. Without it, a press inside the portalled panel would close it. */
  panelRef?: RefObject<HTMLElement | null>
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      const inTrigger = ref.current?.contains(target) ?? false
      const inPanel = panelRef?.current?.contains(target) ?? false
      if (!inTrigger && !inPanel) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose, panelRef])

  useEffect(() => {
    if (!open) return
    return trackStageOverlap(() => [ref.current, panelRef?.current ?? null])
  }, [open, panelRef])

  return ref
}

/**
 * Register an overlay for as long as the popover's elements overlap the stage,
 * re-checking whenever they resize (a menu that grows while its list loads, a
 * panel that flips sides). The check waits a frame so a portalled panel has
 * been positioned first. Returns the cleanup that unregisters.
 */
function trackStageOverlap(elements: () => ReadonlyArray<Element | null>): () => void {
  const setOverlayOpen = useShellStore.getState().setOverlayOpen
  let registered = false
  let frame = 0
  const observer = new ResizeObserver(() => check())
  const observed = new Set<Element>()

  const check = (): void => {
    const roots = elements()
    for (const root of roots) {
      if (root && !observed.has(root)) {
        observed.add(root)
        observer.observe(root)
      }
    }
    // Each root against the stage of ITS document: a block popped out into its
    // own window has no stage there, and must not hide the main window's page.
    const covers = roots.some((root) => {
      if (!root) return false
      const stage = root.ownerDocument.querySelector(STAGE_SELECTOR)?.getBoundingClientRect()
      return coversStage([root], stage ?? null)
    })
    if (covers === registered) return
    registered = covers
    setOverlayOpen(covers)
  }

  frame = requestAnimationFrame(() => {
    frame = 0
    check()
  })
  window.addEventListener('resize', check)

  return () => {
    if (frame) cancelAnimationFrame(frame)
    window.removeEventListener('resize', check)
    observer.disconnect()
    if (registered) setOverlayOpen(false)
  }
}
