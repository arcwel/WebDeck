import { useCallback, useEffect, useState } from 'react'
import { CustomizeToolbar } from '@/components/CustomizeToolbar'
import { browserPrefs, type BrowserDefaultState } from '../../../webui/shell'

/**
 * The browsing controls that are WebDeck's own.
 *
 * Chromium's settings are Chromium's: the menu opens `chrome://settings`, the
 * real page, rather than a copy of it drawn here. A copy could only ever be a
 * subset, and it went stale the moment upstream added a row.
 *
 * What is left is what `chrome://settings` has no way to show, because these
 * are not Chromium's to show:
 *
 *  - the toolbar WebDeck draws itself, which Chromium knows nothing about;
 *  - the ad blocker, which is this fork's, not upstream's;
 *  - the default-browser check, which has to name this app;
 *  - clearing browsing data, kept here because it is the one destructive
 *    action people look for under the app's own settings.
 *
 * Before adding a fifth: could `chrome://settings` show it? If so it does not
 * belong here. See SETTINGS_ARCHITECTURE.md.
 */

const TIME_RANGES = [
  { value: 0, label: 'Last hour' },
  { value: 1, label: 'Last 24 hours' },
  { value: 2, label: 'Last 7 days' },
  { value: 3, label: 'Last 4 weeks' },
  { value: 4, label: 'All time' }
]

export function BrowsingControls(): React.JSX.Element | null {
  const ownsBrowser = window.agweb.host.ownsBrowserFeatures

  const [adblock, setAdblock] = useState<boolean | null>(null)
  const [blockedCount, setBlockedCount] = useState<number | null>(null)
  const [defaultState, setDefaultState] = useState<BrowserDefaultState | undefined>(undefined)
  const [makingDefault, setMakingDefault] = useState(false)

  const [clearCookies, setClearCookies] = useState(true)
  const [clearCache, setClearCache] = useState(true)
  const [clearHistory, setClearHistory] = useState(false)
  const [timeRange, setTimeRange] = useState(4)
  const [clearing, setClearing] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const flash = useCallback((message: string): void => {
    setStatus(message)
    setTimeout(() => setStatus(null), 3000)
  }, [])

  useEffect(() => {
    if (!ownsBrowser) return
    let live = true
    void (async (): Promise<void> => {
      try {
        const enabled = await browserPrefs.getAdblockEnabled()
        if (live) setAdblock(enabled)
      } catch (err) {
        if (live) setError((err as Error).message)
      }
      try {
        const count = await browserPrefs.getAdblockBlockedCount()
        if (live) setBlockedCount(count)
      } catch {
        // Leave blockedCount null; the badge simply doesn't show.
      }
      try {
        const state = await browserPrefs.getDefaultBrowserState()
        if (live) setDefaultState(state)
      } catch {
        // Leave defaultState undefined; the row says the status is unknown.
      }
    })()
    return () => {
      live = false
    }
  }, [ownsBrowser])

  const toggleAdblock = async (value: boolean): Promise<void> => {
    const previous = adblock
    setAdblock(value)
    try {
      await browserPrefs.setAdblockEnabled(value)
      setError(null)
      if (value) {
        try {
          setBlockedCount(await browserPrefs.getAdblockBlockedCount())
        } catch {
          // Keep the last known count; a failed read shouldn't clear the badge.
        }
      }
    } catch (err) {
      setAdblock(previous)
      setError((err as Error).message)
    }
  }

  const clearNow = async (): Promise<void> => {
    setClearing(true)
    try {
      await browserPrefs.clearBrowsingData(clearCookies, clearCache, clearHistory, timeRange)
      flash('Browsing data cleared.')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
    setClearing(false)
  }

  const makeDefault = async (): Promise<void> => {
    setMakingDefault(true)
    try {
      const state = await browserPrefs.makeDefaultBrowser()
      setDefaultState(state)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
    setMakingDefault(false)
  }

  // Off the fork there is no browser to configure, and the toolbar below is
  // drawn by whatever host is embedding the page.
  if (!ownsBrowser) return null

  const nothingToClear = !clearCookies && !clearCache && !clearHistory

  return (
    <div className="flex flex-col gap-0.5" data-testid="browsing-controls">
      <div className="rounded-lg px-2 py-1.5">
        <span className="block font-medium text-[var(--wd-text)]">Toolbar buttons</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">
          Which buttons the toolbar shows. Right-clicking the toolbar opens the same list.
        </span>
        <div className="mt-1.5 rounded-lg border border-[var(--wd-glass-border)] p-1">
          <CustomizeToolbar />
        </div>
      </div>

      {adblock !== null && (
        <>
          <Toggle
            label="Block ads and trackers"
            hint="WebDeck's own blocker. Chromium has none, so this lives here."
            checked={adblock}
            onChange={(v) => void toggleAdblock(v)}
          />
          {adblock && blockedCount !== null && (
            <span className="block px-2 pl-9 text-[11px] text-[var(--wd-dim)]">
              {blockedCount.toLocaleString()} request{blockedCount === 1 ? '' : 's'} blocked
            </span>
          )}
        </>
      )}

      <Row
        label="Default browser"
        hint={
          defaultState === 1
            ? 'WebDeck is your default browser.'
            : defaultState === 0
              ? 'Open links from other apps in WebDeck.'
              : 'Default-browser status is unknown.'
        }
      >
        {defaultState !== 1 && (
          <button
            onClick={() => void makeDefault()}
            disabled={makingDefault}
            className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
            data-testid="make-default-browser"
          >
            {makingDefault ? 'Working…' : 'Make default'}
          </button>
        )}
      </Row>

      <div className="rounded-lg px-2 py-1.5">
        <span className="block font-medium text-[var(--wd-text)]">Clear browsing data</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">
          Cannot be undone. Signed-in sites will ask you to sign in again.
        </span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {(
            [
              ['Cookies', clearCookies, setClearCookies],
              ['Cached files', clearCache, setClearCache],
              ['History', clearHistory, setClearHistory]
            ] as const
          ).map(([itemLabel, checked, set]) => (
            <label key={itemLabel} className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                className="accent-[var(--wd-accent)]"
                checked={checked}
                onChange={(e) => set(e.target.checked)}
              />
              {itemLabel}
            </label>
          ))}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            aria-label="Time range"
            className="rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-1.5 py-1 text-[11px] text-[var(--wd-text)]"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => void clearNow()}
            disabled={clearing || nothingToClear}
            className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
            data-testid="clear-browsing-data"
          >
            {clearing ? 'Clearing…' : 'Clear now'}
          </button>
        </div>
      </div>

      {status && <span className="px-2 text-[11px] text-emerald-500">{status}</span>}
      {error && <span className="px-2 text-[11px] text-rose-500">{error}</span>}
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[var(--wd-text)]">{label}</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      </span>
      <span className="flex flex-none items-center gap-1.5">{children}</span>
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--wd-accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium text-[var(--wd-text)]">{label}</span>
        <span className="block text-[11px] text-[var(--wd-dim)]">{hint}</span>
      </span>
    </label>
  )
}
