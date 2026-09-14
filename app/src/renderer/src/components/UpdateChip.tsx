import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadState, UpdateStatus } from '@shared/updates'
import { useShellStore } from '@/store'
import { usePopover } from '@/popover'
import { AnchoredPopover } from '@/components/AnchoredPopover'

/**
 * "Update": the chip beside Ask that appears when a release newer than this
 * build exists on its channel. The core checks on launch and daily and pushes
 * the answer here; the chip opens a small panel with the version, the notes
 * and two choices — open the release page, or not now. Nothing downloads on
 * its own, and "not now" keeps the chip down until a newer release appears.
 */
export function UpdateChip(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const ref = usePopover(open, close, panelRef)

  useEffect(() => {
    let live = true
    void window.agweb.updates
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => {
        // No checker on this host (an older core): no chip, nothing to say.
      })
    const off = window.agweb.updates.onChanged((next) => live && setStatus(next))
    return () => {
      live = false
      off()
    }
  }, [])

  const release = status?.available ?? null
  if (!release || status?.dismissed === release.version) return null

  const openRelease = (): void => {
    setOpen(false)
    if (release.url) useShellStore.getState().newTab(release.url)
  }
  const notNow = (): void => {
    setOpen(false)
    void window.agweb.updates.dismiss(release.version).then(setStatus)
  }
  const updateNow = (): void => void window.agweb.updates.download().then(setStatus)
  const cancel = (): void => void window.agweb.updates.cancelDownload().then(setStatus)
  const reveal = (): void => void window.agweb.updates.reveal().then(setStatus)
  const download = status?.download?.version === release.version ? status.download : null

  return (
    <div ref={ref} className="no-drag relative flex-none">
      <button
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        className="mr-1.5 flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 text-[11.5px] font-medium text-emerald-600 hover:brightness-110 dark:text-emerald-400"
        aria-label={`WebDeck ${release.version} is available`}
        title={`WebDeck ${release.version} is available — you have ${status?.current}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="update-chip"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
        Update
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          panelRef={panelRef}
          placement="below"
          align="end"
          width={320}
          className="glass rounded-[14px] p-3 text-[12px]"
          role="dialog"
          aria-label="Update available"
          data-testid="update-panel"
        >
          <div className="font-semibold text-[var(--wd-text)]">
            WebDeck {release.version} is available
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--wd-dim)]">
            You have {status?.current}
            {release.publishedAt ? ` · released ${release.publishedAt.slice(0, 10)}` : ''}
            {release.prerelease ? ' · pre-release' : ''}
          </div>
          {release.security && (
            <div
              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400"
              data-testid="update-security"
            >
              Includes Chromium security fixes
              {release.chromium ? ` (${release.chromium})` : ''}
            </div>
          )}
          {release.notes && (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-[var(--wd-muted)]">
              {release.notes}
            </pre>
          )}
          {download && download.phase !== 'error' ? (
            <DownloadProgress download={download} onCancel={cancel} onReveal={reveal} />
          ) : (
            <>
              {download?.error && (
                <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  {download.error}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={notNow}
                  className="rounded-md px-2.5 py-1 text-[11px] text-[var(--wd-dim)] hover:bg-[var(--wd-hover)]"
                >
                  Not now
                </button>
                <button
                  onClick={openRelease}
                  className="rounded-md border border-[var(--wd-glass-border)] px-2.5 py-1 text-[11px] hover:bg-[var(--wd-hover)]"
                  data-testid="update-open"
                >
                  Release page
                </button>
                {release.asset && release.signed && (
                  <button
                    onClick={updateNow}
                    className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
                    data-testid="update-now"
                  >
                    {download?.error ? 'Try again' : 'Update now'}
                  </button>
                )}
              </div>
              {release.asset && !release.signed && (
                <div
                  className="mt-2 text-[10.5px] text-[var(--wd-dim)]"
                  data-testid="update-unsigned"
                >
                  Not signed for in-app update ({release.unsignedReason}); get it from the release
                  page.
                </div>
              )}
            </>
          )}
        </AnchoredPopover>
      )}
    </div>
  )
}

function DownloadProgress({
  download,
  onCancel,
  onReveal
}: {
  download: DownloadState
  onCancel: () => void
  onReveal: () => void
}): React.JSX.Element {
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`
  const pct =
    download.total > 0
      ? Math.min(100, Math.round((download.received / download.total) * 100))
      : null
  const line =
    download.phase === 'downloading'
      ? pct === null
        ? `Downloading… ${mb(download.received)}`
        : `Downloading… ${pct}% of ${mb(download.total)}`
      : download.phase === 'verifying'
        ? 'Checking the download…'
        : download.phase === 'unpacking'
          ? 'Unpacking…'
          : 'Downloaded and unpacked into Downloads.'
  return (
    <div className="mt-3" data-testid="update-progress" data-phase={download.phase}>
      <div className="text-[11px] text-[var(--wd-text)]">{line}</div>
      {download.phase !== 'done' && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--wd-hover)]">
          <div
            className={`h-full rounded-full bg-[var(--wd-accent)] transition-[width] ${pct === null ? 'animate-pulse' : ''}`}
            style={{ width: `${pct ?? 40}%` }}
          />
        </div>
      )}
      {download.phase === 'done' ? (
        <>
          <div className="mt-1.5 text-[11px] text-[var(--wd-dim)]">
            Drag <strong>Arcwel WebDeck</strong> to Applications, replace the old one, then
            relaunch.
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={onReveal}
              className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-110"
              data-testid="update-reveal"
            >
              Show in Finder
            </button>
          </div>
        </>
      ) : (
        <div className="mt-2 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-[11px] text-[var(--wd-dim)] hover:bg-[var(--wd-hover)]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
