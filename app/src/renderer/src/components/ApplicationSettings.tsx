import { useEffect, useState } from 'react'
import {
  SEARCH_ENGINES,
  type AppInfo,
  type AppSettings,
  type ClearableData,
  type HistorySourceInfo
} from '@shared/ipc'
import { useShellStore } from '@/store'
import type { UpdateStatus } from '@shared/updates'
import { pickProfileImage } from '@/profile-image'

/**
 * The Electron application settings — the ones that configure the app itself
 * rather than the editor. This is what "the actual Electron settings" meant:
 * launch behaviour, what a page is allowed to do, and the on-disk state the
 * browser keeps.
 *
 * A form of real toggles rather than a JSON editor, because — unlike VS Code's
 * open-ended, extension-contributed settings surface — this set is small,
 * fixed, and known, so a form is complete and clearer.
 */

const TOGGLES: Array<{ key: keyof AppSettings; label: string; hint: string; restart?: boolean }> = [
  {
    key: 'hardwareAcceleration',
    label: 'Hardware acceleration',
    hint: 'GPU compositing. Turn off if pages render with visual glitches.',
    restart: true
  },
  { key: 'restoreTabs', label: 'Restore tabs on launch', hint: 'Reopen the last session’s tabs.' },
  {
    key: 'showAskButton',
    label: 'Show the Ask button',
    hint: 'The button in the title bar that asks the agent about the page you are on.'
  },
  {
    key: 'askForPermissions',
    label: 'Ask before granting page permissions',
    hint: 'Camera, microphone, location, notifications.'
  },
  {
    key: 'spellcheck',
    label: 'Spell-check text fields',
    hint: 'Underline misspellings as you type.'
  },
  {
    key: 'doNotTrack',
    label: 'Send “Do Not Track”',
    hint: 'Ask sites not to track you. Honouring it is up to them.'
  }
]

/** The toggles above that Chromium owns on the fork, and the page that owns
 *  them. Each writes WebDeck's own settings file, which nothing on this build
 *  reads — a switch that moves and changes nothing is worse than no switch. */
const CHROMIUM_OWNED: Partial<Record<keyof AppSettings, string>> = {
  hardwareAcceleration: 'chrome://settings/system',
  askForPermissions: 'chrome://settings/content',
  spellcheck: 'chrome://settings/languages',
  doNotTrack: 'chrome://settings/cookies'
}

const CLEARABLE: Array<{ kind: ClearableData; label: string }> = [
  { kind: 'cache', label: 'Cached files' },
  { kind: 'cookies', label: 'Cookies' },
  { kind: 'storage', label: 'Site storage' },
  { kind: 'history', label: 'History' }
]

export function ApplicationSettings(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [clearing, setClearing] = useState<Set<ClearableData>>(new Set(['cache']))
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.agweb.appSettings.read().then((next) => live && setSettings(next))
    void window.agweb.getAppInfo().then((next) => live && setInfo(next))
    return () => {
      live = false
    }
  }, [])

  const update = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    try {
      const next = await window.agweb.appSettings.write({ [key]: value })
      setSettings(next)
      if (TOGGLES.find((t) => t.key === key)?.restart) {
        setStatus('Saved — restart WebDeck to apply.')
        setTimeout(() => setStatus(null), 4000)
      }
    } catch (error) {
      // The checkbox is driven entirely by `settings`, so a failed write makes
      // it snap back. Without this the user sees the switch move and return
      // with no reason given.
      setStatus(`Could not save: ${error instanceof Error ? error.message : String(error)}`)
      setTimeout(() => setStatus(null), 6000)
    }
  }

  const clearNow = async (): Promise<void> => {
    await window.agweb.appSettings.clearData([...clearing])
    setStatus('Browsing data cleared.')
    setTimeout(() => setStatus(null), 3000)
  }

  if (!settings) return <div className="p-4 text-[var(--wd-dim)]">Reading settings…</div>

  return (
    <div className="flex flex-col gap-4 p-3 text-[12px]">
      <Section title="General">
        {TOGGLES.filter(
          (t) => !(window.agweb.host.ownsBrowserFeatures && t.key in CHROMIUM_OWNED)
        ).map((toggle) => (
          <label
            key={toggle.key}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--wd-accent)]"
              checked={Boolean(settings[toggle.key])}
              onChange={(e) => void update(toggle.key, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium text-[var(--wd-text)]">
                {toggle.label}
                {toggle.restart && (
                  <span className="rounded bg-[var(--wd-accent-soft)] px-1 text-[9px] font-semibold uppercase text-[var(--wd-accent)]">
                    restart
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-[var(--wd-dim)]">{toggle.hint}</span>
            </span>
          </label>
        ))}
      </Section>

      <Section title="Search">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--wd-text)]">
            Search engine
            <span className="block text-[11px] text-[var(--wd-dim)]">
              Used when you type a search into the address bar.
            </span>
          </span>
          <select
            value={settings.searchEngine}
            onChange={(e) => void update('searchEngine', e.target.value)}
            className="flex-none rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
            aria-label="Search engine"
          >
            {SEARCH_ENGINES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Profile picture">
        <ProfilePicture settings={settings} onChange={setSettings} />
      </Section>

      <Section title="Start page">
        <StartPageSites />
      </Section>

      <Section title="Import browsing history">
        <ImportHistory />
      </Section>

      <Section title="Downloads">
        {/* Downloads belong to the host that performs them. Under the Chromium
            fork that is Chromium: it chooses the folder, decides whether to ask
            each time, and nothing reads WebDeck's copies of those two settings.
            Showing them anyway would be two switches for one behaviour, and the
            folder picker behind "Change…" does not exist on this host — so name
            where the real setting lives rather than offering a dead control. */}
        {window.agweb.host.ownsBrowserFeatures ? (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--wd-dim)]">
            Chromium handles downloads on this build. Change the download folder — and whether
            you’re asked where to save each file — at{' '}
            <span className="select-all font-mono text-[var(--wd-muted)]">
              chrome://settings/downloads
            </span>
            .
          </p>
        ) : (
          <DownloadSettings settings={settings} onChange={setSettings} />
        )}
      </Section>

      {window.agweb.host.ownsBrowserFeatures ? (
        <Section title="Privacy">
          {/* This panel's own clear-data call has no handler on the fork: the
              button reported "no handler for app-settings:clear-data" and
              cleared nothing. Chromium's remover is the real one — the Browser
              tab drives it, and chrome://settings has the full set. */}
          <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--wd-dim)]">
            Clearing browsing data lives on the <strong>Browser</strong> tab, which drives
            Chromium&apos;s own remover. For everything else — site permissions, spell-check
            languages, hardware acceleration and Do Not Track — Chromium owns the setting:
          </p>
          <div className="flex flex-wrap gap-1.5 px-2 pb-1 pt-0.5">
            {(
              [
                ['Site permissions', 'chrome://settings/content'],
                ['Languages & spell-check', 'chrome://settings/languages'],
                ['System & hardware acceleration', 'chrome://settings/system'],
                ['Cookies & Do Not Track', 'chrome://settings/cookies'],
                ['All settings', 'chrome://settings/']
              ] as const
            ).map(([label, url]) => (
              <button
                key={url}
                onClick={() => {
                  useShellStore.getState().newTab(url)
                  useShellStore.getState().setSettingsOpen(false)
                }}
                className="rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
              >
                {label} →
              </button>
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Privacy — clear browsing data">
          <div className="flex flex-wrap gap-2 px-2 py-1">
            {CLEARABLE.map((item) => (
              <label key={item.kind} className="flex items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  className="accent-[var(--wd-accent)]"
                  checked={clearing.has(item.kind)}
                  onChange={(e) =>
                    setClearing((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(item.kind)
                      else next.delete(item.kind)
                      return next
                    })
                  }
                />
                {item.label}
              </label>
            ))}
          </div>
          <button
            onClick={() => void clearNow()}
            disabled={clearing.size === 0}
            className="mx-2 mt-1 w-fit rounded-md bg-rose-500/90 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
          >
            Clear now
          </button>
        </Section>
      )}

      {info && (
        <Section title="About">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 px-2 py-1 text-[11px] text-[var(--wd-muted)]">
            <dt className="text-[var(--wd-dim)]">Version</dt>
            <dd>{info.version}</dd>
            {!window.agweb.host.ownsBrowserFeatures && (
              <>
                <dt className="text-[var(--wd-dim)]">Electron</dt>
                <dd>{info.electron}</dd>
              </>
            )}
            <dt className="text-[var(--wd-dim)]">Chromium</dt>
            <dd>{info.chrome}</dd>
            <dt className="text-[var(--wd-dim)]">Platform</dt>
            <dd>{info.platform}</dd>
          </dl>
          <UpdateRow />
        </Section>
      )}

      {status && <span className="px-2 text-[11px] text-emerald-500">{status}</span>}
    </div>
  )
}

interface DownloadSettingsProps {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}

/**
 * WebDeck's own download location — only rendered where WebDeck performs the
 * download, which is Electron. The folder picker behind "Change…" is a native
 * dialog with no browser equivalent, so this whole block is host-gated by its
 * caller rather than degraded here.
 */
function DownloadSettings({ settings, onChange }: DownloadSettingsProps): React.JSX.Element {
  return (
    <>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--wd-accent)]"
          checked={settings.askWhereToSave}
          onChange={(e) =>
            void window.agweb.appSettings.write({ askWhereToSave: e.target.checked }).then(onChange)
          }
        />
        <span className="min-w-0">
          <span className="block font-medium text-[var(--wd-text)]">
            Ask where to save each file
          </span>
          <span className="block text-[11px] text-[var(--wd-dim)]">
            Choose a location every time, instead of saving to the folder below.
          </span>
        </span>
      </label>
      <div
        className={`flex items-center gap-2 px-2 py-1 ${
          settings.askWhereToSave ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--wd-muted)]">
          {settings.downloadPath || 'Default location (your Downloads folder)'}
        </span>
        <button
          onClick={() => {
            void window.agweb.appSettings.chooseDownloadDir().then(onChange)
          }}
          className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]"
        >
          Change…
        </button>
        {settings.downloadPath && (
          <button
            onClick={() => {
              void window.agweb.appSettings.write({ downloadPath: '' }).then(onChange)
            }}
            className="flex-none text-[11px] text-[var(--wd-dim)] hover:text-rose-500"
          >
            Reset
          </button>
        )}
      </div>
    </>
  )
}

/**
 * The release checker's answer, and a way to ask now. The core checks on
 * launch and daily on its own; this row is for "did it look, and what did it
 * find" — the reason a check failed lives here and nowhere louder.
 */
function UpdateRow(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.agweb.updates
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => {
        // An older core without the checker: the row simply stays empty.
      })
    const off = window.agweb.updates.onChanged((next) => live && setStatus(next))
    return () => {
      live = false
      off()
    }
  }, [])
  if (!status) return <></>
  const when = status.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'not yet'
  const line = status.checking
    ? 'Checking…'
    : status.error
      ? `Could not check: ${status.error}`
      : status.available
        ? `WebDeck ${status.available.version} is available.`
        : status.checkedAt
          ? 'You have the latest release.'
          : 'Not checked yet.'
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px]" data-testid="update-row">
      <span className="min-w-0 flex-1">
        <span
          className={status.error ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--wd-text)]'}
        >
          {line}
        </span>
        <span className="block text-[var(--wd-dim)]">
          Checked on launch and daily, on the {status.channel === 'pre' ? 'pre-release' : 'stable'}{' '}
          channel · last: {when}
        </span>
      </span>
      {status.available && (
        <button
          onClick={() => {
            const url = status.available?.url
            if (url) useShellStore.getState().newTab(url)
          }}
          className="flex-none rounded-md bg-[var(--wd-accent)] px-2 py-1 text-[11px] font-semibold text-white hover:brightness-110"
        >
          Open release page
        </button>
      )}
      <button
        onClick={() => void window.agweb.updates.check().then(setStatus)}
        disabled={status.checking}
        className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] hover:bg-[var(--wd-hover)] disabled:opacity-50"
        data-testid="update-check-now"
      >
        Check now
      </button>
    </div>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * The sites the start page shows, as the user chose them.
 *
 * The choosing happens on the start page itself — hover a tile to hide or
 * unpin it, or add one — and this is the ledger: every pin and every hidden
 * site, each undoable here, so a site hidden by a stray click can be brought
 * back without knowing its address.
 */
function StartPageSites(): React.JSX.Element {
  const startSites = useShellStore((s) => s.startSites)
  const unpinStartSite = useShellStore((s) => s.unpinStartSite)
  const unhideStartSite = useShellStore((s) => s.unhideStartSite)
  const host = (url: string): string => {
    try {
      return new URL(url).host.replace(/^www\./, '')
    } catch {
      return url
    }
  }
  const row = (url: string, action: string, onClick: () => void): React.JSX.Element => (
    <div
      key={url}
      className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--wd-hover)]"
    >
      <span className="min-w-0 flex-1 truncate text-[var(--wd-text)]" title={url}>
        {host(url)}
      </span>
      <button
        onClick={onClick}
        className="rounded border border-[var(--wd-border)] px-2 py-0.5 text-[11px] text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
      >
        {action}
      </button>
    </div>
  )
  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 text-[11px] text-[var(--wd-dim)]">
        The start page shows the sites you pin, then the ones you visit most. Hover a site there to
        hide or unpin it, or use its + tile to add one.
      </p>
      {startSites.pinned.length > 0 && (
        <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--wd-dim)]">
          Pinned
        </div>
      )}
      {startSites.pinned.map((p) => row(p.url, 'Unpin', () => unpinStartSite(p.url)))}
      {startSites.hidden.length > 0 && (
        <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--wd-dim)]">
          Hidden
        </div>
      )}
      {startSites.hidden.map((url) => row(url, 'Show again', () => unhideStartSite(url)))}
      {startSites.pinned.length === 0 && startSites.hidden.length === 0 && (
        <div className="px-2 text-[11px] text-[var(--wd-dim)]">Nothing pinned or hidden yet.</div>
      )}
    </div>
  )
}

/**
 * Bring history over from another browser on this machine.
 *
 * Import rather than sync, because syncing with a Google account is not ours
 * to offer: signing in to a Chromium build is restricted by Google. Reading
 * another browser's own database needs nobody's permission and works today.
 */
function ImportHistory(): React.JSX.Element {
  const [sources, setSources] = useState<HistorySourceInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.agweb.history
      .sources()
      .then((found) => {
        if (!cancelled) setSources(found)
      })
      .catch(() => {
        if (!cancelled) setSources([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const importFrom = (source: HistorySourceInfo): void => {
    setBusy(source.id)
    setNotice(null)
    void window.agweb.history
      .importFrom(source.id)
      .then((result) => {
        if (result.error || !result.entries) {
          setNotice(result.error ?? 'That history could not be read.')
          return
        }
        const added = useShellStore.getState().importHistory(result.entries)
        // Say what changed, not what was read: importing the same browser
        // twice reads thousands of pages and adds none, and "0 new" is the
        // honest report of that.
        setNotice(
          added === 0
            ? `Nothing new from ${source.label} — already imported.`
            : `Added ${added.toLocaleString()} pages from ${source.label}.`
        )
      })
      .catch((error) => setNotice(String(error)))
      .finally(() => setBusy(null))
  }

  if (sources === null) {
    return <p className="px-2 py-1.5 text-[11px] text-[var(--wd-dim)]">Looking for browsers…</p>
  }
  if (sources.length === 0) {
    return (
      <p className="px-2 py-1.5 text-[11px] text-[var(--wd-dim)]">
        No other browser on this Mac has history to import.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1" data-testid="history-import">
      {sources.map((source) => (
        <div key={source.id} className="flex items-center gap-3 px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px]">{source.label}</span>
          <span className="flex-none text-[11px] text-[var(--wd-dim)]">
            {source.error ? source.error : `${(source.entries ?? 0).toLocaleString()} pages`}
          </span>
          <button
            onClick={() => importFrom(source)}
            disabled={busy !== null || !source.entries}
            className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] disabled:opacity-40"
            data-testid={`history-import-${source.id}`}
          >
            {busy === source.id ? 'Importing…' : 'Import'}
          </button>
        </div>
      ))}
      {notice && (
        <p
          className="px-2 pb-1 text-[11px] text-[var(--wd-dim)]"
          data-testid="history-import-notice"
        >
          {notice}
        </p>
      )}
    </div>
  )
}

/** Pick or clear the picture the profile button shows. */
function ProfilePicture({
  settings,
  onChange
}: {
  settings: AppSettings
  onChange: (next: AppSettings) => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const image = settings.profileImage
  return (
    <div className="flex items-center gap-3 px-2 py-1.5">
      {image ? (
        <img
          src={image}
          alt=""
          className="h-10 w-10 flex-none rounded-full object-cover"
          data-testid="profile-image-preview"
        />
      ) : (
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--wd-field)] text-[15px] text-[var(--wd-dim)]">
          ?
        </span>
      )}
      <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--wd-dim)]">
        Shown on the profile button. Any image works; it is cropped square and stored at 128px.
      </span>
      <button
        onClick={() => {
          void pickProfileImage().then((picked) => {
            if (!picked) return
            void window.agweb.appSettings
              .write({ profileImage: picked })
              .then(onChange)
              .catch((err) => setError(String(err)))
          })
        }}
        className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-1 text-[11px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)]"
        data-testid="profile-image-choose"
      >
        Choose image…
      </button>
      {image && (
        <button
          onClick={() => {
            void window.agweb.appSettings
              .write({ profileImage: '' })
              .then(onChange)
              .catch((err) => setError(String(err)))
          }}
          className="flex-none rounded-md px-2 py-1 text-[11px] text-[var(--wd-dim)] hover:text-rose-500"
        >
          Remove
        </button>
      )}
      {error && <span className="text-[10.5px] text-rose-500">{error}</span>}
    </div>
  )
}
