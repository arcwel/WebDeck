/**
 * Does a popover lie over the stage? Pure geometry, kept apart from the hook
 * (popover.ts) so it can be pinned without the store behind it.
 */

/** The element the native page view is glued to (Stage.tsx). */
export const STAGE_SELECTOR = '.stage'

/** A rectangle's extent, in the CSS pixels getBoundingClientRect reports. */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Does any part of these subtrees lie over the stage? A popover is a trigger
 * plus a panel that is absolutely or fixed positioned, so the root's own rect
 * says nothing about where the panel landed — every descendant is measured.
 * Hidden panels (an AnchoredPopover before its first measure) are skipped.
 */
export function coversStage(
  roots: ReadonlyArray<Element | null | undefined>,
  stage: Box | null
): boolean {
  if (!stage || stage.right <= stage.left || stage.bottom <= stage.top) return false
  for (const root of roots) {
    if (!root) continue
    const view = root.ownerDocument.defaultView
    if (view && view.getComputedStyle(root).visibility === 'hidden') continue
    const nodes: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]
    for (const node of nodes) {
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      if (intersects(rect, stage)) return true
    }
  }
  return false
}
