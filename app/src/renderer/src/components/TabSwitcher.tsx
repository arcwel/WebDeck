import { useEffect, useMemo, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { fuzzyMatch } from '@/commands'
import { GlobeIcon, DocIcon } from '@/components/icons'

/**
 * The tab switcher (⌘⇧A).
 *
 * A fuzzy-searchable list of open tabs — favicon, title, and URL — that jumps
 * to the chosen tab via the store's existing `activateTab`. Same overlay-count
 * dance as the Settings surface and the command palette: raise it so the
 * native WebContentsView hides and this DOM shows through.
 */
interface TabSwitcherProps {
  open: boolean
  onClose: () => void
}

/** A tab flattened for display: what the row and the fuzzy search need. */
interface TabRow {
  id: string
  title: string
  url: string
  favicon?: string
  isDoc: boolean
}

export function TabSwitcher({ open, onClose }: TabSwitcherProps): React.JSX.Element | null {
  const tabs = useShellStore((s) => s.tabs)
  const browserStates = useShellStore((s) => s.browserStates)
  const activateTab = useShellStore((s) => s.activateTab)
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The element focused before the switcher opened, so focus can be handed back
  // when it closes instead of being stranded on the (now-hidden) overlay.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const rows = useMemo<TabRow[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url:
          tab.kind === 'doc'
            ? (tab.docPath ?? '')
            : tab.kind === 'editors'
              ? ''
              : (browserStates[tab.id]?.url ?? tab.initialUrl ?? ''),
        favicon: tab.favicon,
        isDoc: tab.kind !== 'web'
      })),
    [tabs, browserStates]
  )

  const results = useMemo<TabRow[]>(() => {
    const scored = rows
      .map((row) => ({ row, score: fuzzyMatch(query, `${row.title} ${row.url}`) }))
      .filter((entry): entry is { row: TabRow; score: number } => entry.score !== null)
    scored.sort((a, b) => b.score - a.score)
    return scored.map((entry) => entry.row)
  }, [rows, query])

  useEffect(() => {
    if (!open) return
    setOverlayOpen(true)
    return () => setOverlayOpen(false)
  }, [open, setOverlayOpen])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('')
    setSelected(0)
    inputRef.current?.focus()
  }, [open])

  // Capture the previously-focused element on open and restore it on close, so
  // dismissing the switcher returns keyboard focus where it was.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    return () => restoreFocusRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected((current) => (current >= results.length ? 0 : current))
  }, [results.length])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected, open])

  if (!open) return null

  const switchTo = (row: TabRow): void => {
    onClose()
    activateTab(row.id)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = results[selected]
      if (row) switchTo(row)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  // Trap Tab within the panel so focus can't wander to the hidden page behind
  // the modal: cycle from the last focusable element back to the first (and the
  // reverse for Shift+Tab).
  const onTrapKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activeId = results[selected] ? `wd-tab-${results[selected].id}` : undefined

  return (
    <div
      className="fixed inset-0 z-[210] flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      data-testid="tab-switcher"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Switch tab"
        className="glass wd-cmd-panel flex w-[min(620px,94vw)] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--wd-r-stage)' }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onTrapKeyDown}
      >
        <div className="flex-none border-b border-[var(--wd-glass-border)] px-3 py-2">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="wd-tab-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search open tabs"
            type="text"
            placeholder="Switch to tab…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="wd-cmd-input w-full bg-transparent text-[14px] text-[var(--wd-text)] outline-none placeholder:text-[var(--wd-dim)]"
          />
        </div>
        <ul
          ref={listRef}
          id="wd-tab-listbox"
          role="listbox"
          aria-label="Open tabs"
          className="max-h-[min(420px,60vh)] min-h-0 flex-1 overflow-y-auto py-1"
        >
          {results.length === 0 ? (
            <li
              className="px-3 py-6 text-center text-[13px] text-[var(--wd-dim)]"
              aria-disabled="true"
            >
              No matching tabs
            </li>
          ) : (
            results.map((row, index) => (
              <li
                key={row.id}
                id={`wd-tab-${row.id}`}
                data-index={index}
                role="option"
                aria-selected={index === selected}
                onClick={() => switchTo(row)}
                onMouseMove={() => setSelected(index)}
                className={`wd-cmd-row mx-1 flex cursor-pointer items-center gap-3 rounded-[var(--wd-r-inner)] px-2.5 py-2 ${
                  index === selected ? 'wd-cmd-row-active' : ''
                }`}
              >
                <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center">
                  {row.isDoc ? (
                    <DocIcon size={14} className="text-[var(--wd-dim)]" />
                  ) : row.favicon ? (
                    <img
                      src={row.favicon}
                      alt=""
                      className="h-[14px] w-[14px] rounded-[2px] object-contain"
                    />
                  ) : (
                    <GlobeIcon size={14} className="text-[var(--wd-dim)]" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-[var(--wd-text)]">{row.title}</span>
                  {row.url && (
                    <span className="truncate text-[11px] text-[var(--wd-dim)]">{row.url}</span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
