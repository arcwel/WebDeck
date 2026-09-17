import { describe, it, expect } from 'vitest'
import {
  TOOLBAR_BUTTONS,
  isToolbarButtonVisible,
  sanitizeHiddenToolbarButtons
} from './toolbar-buttons'

/**
 * The hidden list comes back from a settings file a person can edit, so it is
 * cleaned before anything acts on it: an unknown id must never hide a button
 * nobody named, and the list must not grow duplicates.
 */
describe('the customizable toolbar buttons', () => {
  it('names each button once, and never one that is not customizable', () => {
    const ids = TOOLBAR_BUTTONS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Navigation, the address bar, the menu, the profile button and the Deck
    // toggle are deliberately absent: a toolbar you can empty is one you can
    // lock yourself out of.
    for (const fixed of ['back', 'forward', 'reload', 'home', 'menu', 'profiles', 'deck']) {
      expect(ids).not.toContain(fixed)
    }
    for (const button of TOOLBAR_BUTTONS) {
      expect(button.label.length).toBeGreaterThan(0)
      expect(button.hint.length).toBeGreaterThan(0)
    }
  })

  it('keeps only ids this build knows, and drops duplicates', () => {
    expect(sanitizeHiddenToolbarButtons(['reader', 'nope', 'reader', 'find'])).toEqual([
      'reader',
      'find'
    ])
    expect(sanitizeHiddenToolbarButtons('reader')).toEqual([])
    expect(sanitizeHiddenToolbarButtons(undefined)).toEqual([])
    expect(sanitizeHiddenToolbarButtons([1, null, { id: 'reader' }])).toEqual([])
  })

  it('reports visibility against the hidden list', () => {
    expect(isToolbarButtonVisible('reader', ['find'])).toBe(true)
    expect(isToolbarButtonVisible('find', ['find'])).toBe(false)
    expect(isToolbarButtonVisible('find', [])).toBe(true)
  })
})
