// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { coversStage } from './stage-overlap'

/**
 * A popover only hides the page (registers an overlay) while some part of it
 * lies over the stage. jsdom lays nothing out, so each element is given the
 * rect it would have on screen.
 */
type Rect = { left: number; top: number; width: number; height: number }

function el(rect: Rect, ...children: Element[]): HTMLElement {
  const node = document.createElement('div')
  node.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({})
    }) as DOMRect
  for (const child of children) node.appendChild(child)
  document.body.appendChild(node)
  return node
}

const STAGE = { left: 300, top: 90, right: 1000, bottom: 700 }

describe('coversStage', () => {
  it('is false for a menu that stays inside its block, beside the stage', () => {
    // A composer menu in the dock, below the stage's bottom edge.
    const panel = el({ left: 320, top: 720, width: 280, height: 200 })
    const trigger = el({ left: 330, top: 930, width: 40, height: 24 })
    expect(coversStage([trigger, panel], STAGE)).toBe(false)
  })

  it('is true when the (absolutely positioned) panel runs over the stage', () => {
    // The trigger sits in the toolbar above the stage; the menu drops into it.
    const menu = el({ left: 400, top: 80, width: 240, height: 300 })
    const trigger = el({ left: 400, top: 50, width: 40, height: 24 }, menu)
    expect(coversStage([trigger], STAGE)).toBe(true)
  })

  it('measures descendants, not only the root: the root rect is just the trigger', () => {
    const menu = el({ left: 320, top: 100, width: 200, height: 200 })
    const root = el({ left: 10, top: 10, width: 40, height: 24 }, menu)
    expect(coversStage([root], STAGE)).toBe(true)
  })

  it('ignores an edge that only touches, and collapsed elements', () => {
    const touching = el({ left: 0, top: 0, width: 300, height: 700 }) // right edge == stage.left
    const collapsed = el({ left: 500, top: 300, width: 0, height: 0 })
    expect(coversStage([touching, collapsed], STAGE)).toBe(false)
  })

  it('skips a panel that is still hidden (an AnchoredPopover before its first measure)', () => {
    const hidden = el({ left: 0, top: 0, width: 400, height: 400 })
    hidden.style.visibility = 'hidden'
    expect(coversStage([hidden], STAGE)).toBe(false)
  })

  it('is false without a stage (a popped-out Deck window has none)', () => {
    const panel = el({ left: 320, top: 100, width: 200, height: 200 })
    expect(coversStage([panel], null)).toBe(false)
    expect(coversStage([null, undefined], STAGE)).toBe(false)
  })
})
