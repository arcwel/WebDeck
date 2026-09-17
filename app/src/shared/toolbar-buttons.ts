/**
 * The toolbar buttons a person may hide.
 *
 * Chrome lets you pin and unpin the icons beside the address bar; WebDeck draws
 * its own toolbar, so it has to offer the same thing itself. Only the action
 * cluster is customizable — the controls that *are* the browser (back, forward,
 * reload, home, the address bar, the menu, the profile button and the Deck
 * toggle) stay put, because a toolbar you can empty is a toolbar you can lock
 * yourself out of.
 *
 * The order here is the order they sit in the toolbar, which is the order the
 * customize panel lists them in.
 */
export interface ToolbarButton {
  id: string
  label: string
  /** What it does, for the customize panel. */
  hint: string
}

export const TOOLBAR_BUTTONS: readonly ToolbarButton[] = [
  { id: 'reader', label: 'Reader mode', hint: 'Strip a page down to its article.' },
  { id: 'bookmark', label: 'Bookmark this page', hint: 'The star in the address bar.' },
  { id: 'bookmarks', label: 'Bookmarks', hint: 'Open the bookmarks list.' },
  { id: 'zoom', label: 'Zoom', hint: 'Page zoom for this site.' },
  { id: 'utilities', label: 'Favourites bar', hint: 'Show the row of favourite sites.' },
  { id: 'split', label: 'Split view', hint: 'Stage two tabs side by side.' },
  { id: 'pip', label: 'Picture-in-Picture', hint: 'Pop a video out of the page.' },
  { id: 'extensions', label: 'Extensions', hint: 'Browser extensions and their actions.' },
  { id: 'find', label: 'Find in page', hint: 'Search the page (⌘F still works).' }
]

const IDS: ReadonlySet<string> = new Set(TOOLBAR_BUTTONS.map((b) => b.id))

/** Keep only ids this build knows, so a stale or hand-edited list cannot hide something unnamed. */
export function sanitizeHiddenToolbarButtons(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && IDS.has(v)))]
}

export function isToolbarButtonVisible(id: string, hidden: readonly string[]): boolean {
  return !hidden.includes(id)
}
