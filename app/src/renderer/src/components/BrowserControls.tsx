import { useCallback, useEffect, useState } from 'react'
import { useShellStore } from '@/store'
import { usePopover } from '@/popover'
import {
  BookmarksIcon,
  SearchIcon,
  StarFilledIcon,
  StarIcon,
  ZoomInIcon
} from '@/components/browser-icons'
import { navigateTab } from '@/components/Toolbar'
import { parseBookmarks } from '@/bookmarks-import'

/**
 * The browser chrome a real browser has and this one was missing: bookmarks,
 * find-in-page and zoom.
 *
 * Kept out of Toolbar.tsx because each owns its own popover and transient
 * state, and the toolbar was already the longest component in the shell.
 */

// No box: the design's icons are bare glyphs that tint on hover.
const button = 'wd-icon'

export function BookmarkControls({
  tabId,
  url,
  title,
  align = 'right',
  showStar = true,
  showList = true
}: {
  tabId: string
  url: string
  title: string
  /** The star. Hidden from the customize panel; ⌘D is Chromium's own. */
  showStar?: boolean
  /** The list button. */
  showList?: boolean
  /** Which edge the bookmarks list drops from — left when the star leads the bar. */
  align?: 'left' | 'right'
}): React.JSX.Element {
  const bookmarks = useShellStore((s) => s.bookmarks)
  const addBookmark = useShellStore((s) => s.addBookmark)
  const removeBookmark = useShellStore((s) => s.removeBookmark)
  const setHomeUrl = useShellStore((s) => s.setHomeUrl)
  const [open, setOpen] = useState(false)

  // Import a browser's exported bookmarks (HTML or Chrome JSON) into this
  // profile. Main reads the file the user picks; parsing happens here where a
  // DOMParser is available.
  const importBookmarks = async (): Promise<void> => {
    const result = await window.agweb.bookmarks.importFile()
    if (!result.text) return
    useShellStore.getState().importBookmarks(parseBookmarks(result.text))
    setOpen(true)
  }
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const saved = bookmarks.some((b) => b.url === url)

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {showStar && (
        <button
          className={button}
          disabled={!url}
          onClick={() => (saved ? removeBookmark(url) : addBookmark(url, title))}
          aria-label={saved ? 'Remove bookmark' : 'Bookmark this page'}
          title={saved ? 'Remove bookmark' : 'Bookmark this page'}
          data-testid="bookmark-toggle"
        >
          {saved ? <StarFilledIcon size={16} className="text-amber-400" /> : <StarIcon size={16} />}
        </button>
      )}

      {showList && (
        <button
          className={button}
          onClick={() => setOpen(!open)}
          aria-label="Bookmarks"
          title="Bookmarks"
          data-testid="bookmarks-menu"
        >
          <BookmarksIcon size={16} />
        </button>
      )}

      {open && (
        <div
          // Floats clear of the toolbar (top-11 leaves the bar visible behind it) and
          // wears the same glass as every other popover, banner padded like theirs.
          className={`glass absolute ${align === 'left' ? 'left-0' : 'right-0'} top-11 z-50 max-h-[min(24rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[14px] py-1.5`}
        >
          <div className="flex items-center justify-between px-3.5 pb-2 pt-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
              Bookmarks · this profile
            </span>
            <button
              onClick={() => {
                setOpen(false)
                void importBookmarks()
              }}
              className="text-[10.5px] font-medium text-sky-500 hover:underline"
            >
              Import…
            </button>
          </div>
          {bookmarks.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-400">
              No bookmarks yet — the star saves the current page, or Import a browser export.
            </div>
          )}
          {bookmarks.map((bookmark) => (
            <div
              key={bookmark.url}
              className="group flex items-center gap-1 px-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <button
                onClick={() => {
                  setOpen(false)
                  void navigateTab(tabId, bookmark.url)
                }}
                className="min-w-0 flex-1 py-1.5 text-left"
              >
                <span className="block truncate text-xs text-slate-600 dark:text-slate-300">
                  {bookmark.title}
                </span>
                <span className="block truncate text-[10px] text-slate-400">{bookmark.url}</span>
              </button>
              <button
                onClick={() => setHomeUrl(bookmark.url)}
                className="rounded px-1 text-[10px] text-slate-400 opacity-0 hover:text-sky-500 group-hover:opacity-100"
                title="Use as home page"
              >
                home
              </button>
              <button
                onClick={() => removeBookmark(bookmark.url)}
                className="rounded px-1 text-[11px] text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100"
                aria-label={`Remove ${bookmark.title}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Find in page (⌘F), with Chromium's own match counts. */
export function FindBar({
  tabId,
  showButton = true
}: {
  tabId: string
  /** Hiding the button must not take ⌘F with it: the component stays mounted
   *  (it owns that shortcut) and simply draws nothing until the bar opens. */
  showButton?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ matches: number; active: number } | null>(null)

  useEffect(
    () =>
      window.agweb.browser.onFindResult((r) => {
        if (r.tabId === tabId) setResult({ matches: r.matches, active: r.active })
      }),
    [tabId]
  )

  // ⌘F belongs to the page the user is looking at, and the shell forwards it
  // from the web view (P1-14), so listening here covers both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setResult(null)
    void window.agweb.browser.findStop(tabId)
  }

  if (!open) {
    if (!showButton) return null
    return (
      <button
        className={button}
        onClick={() => setOpen(true)}
        aria-label="Find in page"
        title="Find in page (⌘F)"
        data-testid="find-open"
      >
        <SearchIcon size={16} />
      </button>
    )
  }

  return (
    <div
      className="flex h-8 items-center gap-1 rounded-lg border border-sky-500 px-1.5"
      data-testid="find-bar"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          void window.agweb.browser.find(tabId, e.target.value, false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void window.agweb.browser.find(tabId, query, true)
          if (e.key === 'Escape') close()
        }}
        placeholder="Find"
        className="w-32 bg-transparent text-xs outline-none"
      />
      <span className="w-12 shrink-0 text-center font-mono text-[10px] text-slate-400">
        {result && result.matches > 0 ? `${result.active}/${result.matches}` : query ? '0/0' : ''}
      </span>
      <button
        onClick={() => void window.agweb.browser.find(tabId, query, true)}
        className="rounded px-1 text-xs text-slate-400 hover:text-slate-600"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        onClick={close}
        className="rounded px-1 text-xs text-slate-400 hover:text-slate-600"
        aria-label="Close find"
      >
        ×
      </button>
    </div>
  )
}

/** Page zoom. Chromium's levels are logarithmic; these are the usual steps. */
export function ZoomControls({ tabId }: { tabId: string }): React.JSX.Element | null {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    let live = true
    void window.agweb.browser.zoom(tabId).then((l) => {
      if (live) setLevel(l)
    })
    return () => {
      live = false
    }
  }, [tabId])

  const apply = (next: number): void => {
    void window.agweb.browser.zoom(tabId, next).then(setLevel)
  }

  const percent = Math.round(Math.pow(1.2, level) * 100)
  if (level === 0) {
    return (
      <button
        className={button}
        onClick={() => apply(1)}
        aria-label="Zoom in"
        title="Zoom"
        data-testid="zoom"
      >
        <ZoomInIcon size={16} />
      </button>
    )
  }

  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg border border-slate-300 px-1 dark:border-slate-700">
      <button
        onClick={() => apply(level - 1)}
        className="px-1 text-xs text-slate-500 hover:text-slate-700"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        onClick={() => apply(0)}
        className="min-w-10 text-center font-mono text-[10px] text-slate-500 hover:text-sky-500"
        title="Reset zoom"
      >
        {percent}%
      </button>
      <button
        onClick={() => apply(level + 1)}
        className="px-1 text-xs text-slate-500 hover:text-slate-700"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  )
}
