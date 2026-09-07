import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, RecentProject } from '@shared/ipc'
import { useShellStore } from '@/store'
import { navigateTab, toNavigableUrl } from '@/components/Toolbar'
import { hostLabel, normalizeSiteInput, startPageTiles } from '@/start-sites'

/**
 * The new-tab page: a browser's start page first, a project opener second.
 *
 * Every new tab lands here. The address field is focused, the sites you go
 * back to are one click away, bookmarks sit under them, and projects are one
 * quiet row at the bottom — recents plus "Open a project…", which opens the
 * native folder panel. The brand lockup shows only while the profile is fresh
 * (nothing visited, nothing opened); after that the page gets out of the way.
 */
const TOP_SITES = 8
const BOOKMARK_CHIPS = 8
const RECENT_PROJECTS = 5

export function StartPage(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const workspace = useShellStore((s) => s.workspace)
  const history = useShellStore((s) => s.history)
  const bookmarks = useShellStore((s) => s.bookmarks)
  const startSites = useShellStore((s) => s.startSites)
  const pinStartSite = useShellStore((s) => s.pinStartSite)
  const unpinStartSite = useShellStore((s) => s.unpinStartSite)
  const hideStartSite = useShellStore((s) => s.hideStartSite)
  const [addingSite, setAddingSite] = useState(false)
  const [newSite, setNewSite] = useState('')
  const [newSiteError, setNewSiteError] = useState('')
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [query, setQuery] = useState('')
  const [typedPath, setTypedPath] = useState('')
  const [showPathBox, setShowPathBox] = useState(false)
  const [pathError, setPathError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.agweb.getRecentProjects().then(setRecent)
    void window.agweb.getAppInfo().then(setInfo)
  }, [workspace])

  // The address field takes focus so a new tab is one keystroke from a page.
  useEffect(() => {
    searchRef.current?.focus()
  }, [activeTabId])

  const tiles = useMemo(() => startPageTiles(startSites, history, TOP_SITES), [startSites, history])

  const addSite = (): void => {
    const url = normalizeSiteInput(newSite)
    if (!url) {
      setNewSiteError('Enter a web address, like example.com.')
      return
    }
    pinStartSite(url)
    setNewSite('')
    setNewSiteError('')
    setAddingSite(false)
  }
  const fresh = history.length === 0 && recent.length === 0 && !workspace
  const canPick = window.agweb.host.canPickPaths

  const go = (input: string): void => {
    const url = toNavigableUrl(input)
    if (url) void navigateTab(activeTabId, url)
  }

  const openFolder = async (): Promise<void> => {
    setPathError('')
    const ws = await window.agweb.openWorkspace()
    if (ws) setWorkspace(ws)
  }

  const openTypedPath = async (): Promise<void> => {
    const path = typedPath.trim()
    if (!path) return
    setPathError('')
    const ws = await window.agweb.openWorkspacePath(path)
    if (ws) {
      setWorkspace(ws)
      setTypedPath('')
      setShowPathBox(false)
    } else {
      setPathError(`Could not open "${path}" — check the path and try again.`)
    }
  }

  return (
    <div
      className="flex h-full flex-col items-center overflow-y-auto bg-slate-50 px-6 text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100"
      data-testid="start-page"
    >
      <div
        className={`flex w-full max-w-2xl shrink-0 flex-col items-center ${fresh ? 'pt-[12vh]' : 'pt-[16vh]'}`}
      >
        {fresh ? (
          <div className="mb-8 flex flex-col items-center gap-3">
            <img
              src="./webdeck-lockup-light.svg"
              alt="Arcwel WebDeck"
              width={276}
              height={88}
              className="h-auto max-w-full dark:hidden"
            />
            <img
              src="./webdeck-lockup-dark.svg"
              alt="Arcwel WebDeck"
              width={276}
              height={88}
              className="hidden h-auto max-w-full dark:block"
            />
            <div className="text-sm text-slate-500">
              Browse anywhere. Press{' '}
              <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
                ⌘D
              </kbd>{' '}
              when it&apos;s time to build.
            </div>
          </div>
        ) : (
          <img src="./webdeck-icon.svg" alt="" width={60} height={60} className="mb-6 opacity-80" />
        )}

        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault()
            go(query)
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or enter address"
            aria-label="Search or enter address"
            spellCheck={false}
            autoComplete="off"
            data-testid="start-search"
            className="glass w-full rounded-full border border-[var(--wd-glass-border)] px-5 py-3 text-[15px] text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--wd-accent)] dark:text-slate-100"
          />
        </form>

        {/* The sites: pinned first, then the most visited, each with a hide or
            unpin control on hover, and a tile to add one. These are the user's
            to choose (start-sites.ts); history only fills what the pins leave. */}
        <div
          className="mt-8 flex w-full flex-wrap justify-center gap-3"
          data-testid="start-top-sites"
        >
          {tiles.map((site) => (
            <div key={site.url} className="group relative w-[76px]">
              <button
                onClick={() => void navigateTab(activeTabId, site.url)}
                title={site.url}
                className="flex w-full flex-col items-center gap-2 rounded-xl px-1 py-3 hover:bg-slate-200/70 dark:hover:bg-slate-800/70"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-200">
                  <SiteIcon url={site.url} favicon={site.favicon} />
                </span>
                <span className="w-full truncate text-center text-[11px] text-slate-600 dark:text-slate-300">
                  {site.title || hostLabel(site.url)}
                </span>
              </button>
              <button
                onClick={() => (site.pinned ? unpinStartSite(site.url) : hideStartSite(site.url))}
                aria-label={
                  site.pinned
                    ? `Unpin ${hostLabel(site.url)}`
                    : `Hide ${hostLabel(site.url)} from the start page`
                }
                title={site.pinned ? 'Unpin' : 'Hide from the start page'}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[11px] leading-none text-white shadow group-hover:flex focus:flex dark:bg-slate-200 dark:text-slate-900"
              >
                {site.pinned ? '⌖' : '×'}
              </button>
            </div>
          ))}
          <button
            onClick={() => setAddingSite((v) => !v)}
            aria-label="Add a site to the start page"
            title="Add a site"
            data-testid="start-add-site"
            className="flex w-[76px] flex-col items-center gap-2 rounded-xl px-1 py-3 hover:bg-slate-200/70 dark:hover:bg-slate-800/70"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-slate-400 text-lg text-slate-500 dark:border-slate-600">
              +
            </span>
            <span className="text-[11px] text-slate-500">Add site</span>
          </button>
        </div>
        {addingSite && (
          <form
            className="mt-3 flex w-full max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addSite()
            }}
          >
            <input
              autoFocus
              value={newSite}
              onChange={(e) => {
                setNewSite(e.target.value)
                setNewSiteError('')
              }}
              placeholder="example.com"
              aria-label="Site to add"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
            >
              Pin
            </button>
          </form>
        )}
        {newSiteError && <div className="mt-1 text-xs text-rose-500">{newSiteError}</div>}

        {bookmarks.length > 0 && (
          <div
            className="mt-6 flex w-full flex-wrap justify-center gap-2"
            data-testid="start-bookmarks"
          >
            {bookmarks.slice(0, BOOKMARK_CHIPS).map((b) => (
              <button
                key={b.url}
                onClick={() => void navigateTab(activeTabId, b.url)}
                title={b.url}
                className="glass max-w-[180px] truncate rounded-full border border-[var(--wd-glass-border)] px-3 py-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              >
                {b.title || hostLabel(b.url)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto w-full max-w-2xl pb-8 pt-12" data-testid="start-projects">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Projects
          </span>
          {workspace && (
            <span className="truncate text-[11px] text-slate-500" title={workspace.path}>
              Current: <span className="text-slate-700 dark:text-slate-300">{workspace.name}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {recent.slice(0, RECENT_PROJECTS).map((project) => (
            <button
              key={project.path}
              onClick={() => void window.agweb.openWorkspacePath(project.path)}
              title={project.path}
              className={`glass max-w-[200px] truncate rounded-full border px-3 py-1 text-xs ${
                workspace?.path === project.path
                  ? 'border-[var(--wd-accent)] text-slate-900 dark:text-slate-100'
                  : 'border-[var(--wd-glass-border)] text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100'
              }`}
            >
              ▸ {project.name}
            </button>
          ))}
          {canPick ? (
            <button
              onClick={() => void openFolder()}
              data-testid="start-open"
              className="rounded-full bg-sky-600 px-3.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
            >
              Open a project…
            </button>
          ) : null}
          <button
            onClick={() => setShowPathBox((v) => !v)}
            className="text-[11px] text-slate-500 underline-offset-2 hover:underline"
          >
            {showPathBox ? 'hide path' : 'type a path'}
          </button>
        </div>
        {(showPathBox || !canPick) && (
          <div className="mt-2 flex gap-2">
            <input
              id="wd-project-path"
              value={typedPath}
              onChange={(e) => setTypedPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void openTypedPath()
              }}
              placeholder="~/code/my-project"
              spellCheck={false}
              aria-label="Open a project by path"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              onClick={() => void openTypedPath()}
              disabled={!typedPath.trim()}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Open
            </button>
          </div>
        )}
        {pathError && <div className="mt-1 text-xs text-rose-500">{pathError}</div>}
        {info && (
          <div className="mt-4 text-[11px] text-slate-400 dark:text-slate-600">
            WebDeck {info.version}
            {info.chrome ? ` · Chromium ${info.chrome}` : ''} · ⌘D reveals the Dev Deck
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A site's icon: the favicon the page reported while it was open, else the
 * profile's favicon database through chrome://favicon2 (registered for this
 * page in webdeck_ui.cc), else the first letter of the host. The database
 * holds an icon for every site the profile has visited, so the letter is for
 * a site pinned by hand and never opened, or a host with no favicon at all.
 */
function SiteIcon({ url, favicon }: { url: string; favicon?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const src =
    favicon ?? `chrome://favicon2/?size=20&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}`
  if (failed) return <>{(hostLabel(url)[0] ?? '?').toUpperCase()}</>
  return <img src={src} alt="" width={20} height={20} onError={() => setFailed(true)} />
}
