import { useCallback, useEffect, useState } from 'react'
import type { VsxExtension, VsxInstalled } from '@shared/ipc'
import {
  extensionActivations,
  isRegistered,
  onEditorExtensionsChanged,
  registerInstalled,
  unregisterInstalled,
  type ExtensionActivation
} from '@/editor-extensions'
import { extensionHostStarted } from '@/monaco'
import { needsExtensionHost } from '@/extension-host-policy'

/**
 * Editor extensions from Open VSX (task 12.8): search the registry, install
 * into the running editor, and manage what is installed.
 *
 * Install goes through the core, which gates it as a `command`-class policy
 * action — in Secure mode the user confirms — and stores the unpacked
 * extension. On success the extension is registered live, so a theme shows up
 * in the theme picker without a restart. Uninstall is the mirror.
 */

type Busy = { id: string; what: 'install' | 'uninstall' } | null

/**
 * Whether the extension's code can run in the web worker host. A `browser`
 * entry point means yes; no entry point at all (themes, grammars, keymaps)
 * means there is nothing to run and that is fine; `main` only means it was
 * built for desktop VS Code and its commands/views will stay inert here.
 */
function isWebCapable(ext: VsxInstalled): boolean {
  const manifest = ext.manifest as { browser?: unknown; main?: unknown }
  return Boolean(manifest.browser) || !manifest.main
}

/** One phrase for what the host did with a code extension. */
function activationLabel(ext: VsxInstalled, a: ExtensionActivation | undefined): string {
  const manifest = ext.manifest as { browser?: unknown }
  if (!manifest.browser) return 'declarative — nothing to run'
  if (!extensionHostStarted) return 'runs after a reload'
  if (!a) return 'host status pending'
  if (a.errors.length) return 'activation failed'
  if (a.activateMs !== undefined) return `activated in ${Math.round(a.activateMs)} ms`
  if (a.started) return 'activating…'
  return 'not activated yet (waits for its activation event)'
}

export function ExtensionsBlock(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<VsxExtension[]>([])
  const [installed, setInstalled] = useState<VsxInstalled[]>([])
  const [activation, setActivation] = useState<Record<string, ExtensionActivation>>({})
  // What the host says about each extension, refreshed as extensions change
  // and again a few seconds later, when a slow activation has had time to land.
  useEffect(() => {
    let live = true
    const refresh = (): void => {
      void extensionActivations().then((a) => {
        if (live) setActivation(a)
      })
    }
    refresh()
    const later = setTimeout(refresh, 4000)
    const off = onEditorExtensionsChanged(() => {
      refresh()
      setTimeout(refresh, 4000)
    })
    return () => {
      live = false
      clearTimeout(later)
      off()
    }
  }, [installed])
  const [busy, setBusy] = useState<Busy>(null)
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setInstalled(await window.agweb.vsx.list())
    } catch (err) {
      setStatus({ kind: 'error', text: `Could not list extensions: ${(err as Error).message}` })
    }
  }, [])

  // Initial load: state is set from the promise callback, not synchronously in
  // the effect body, and a stale result is dropped if the block unmounts.
  useEffect(() => {
    let live = true
    window.agweb.vsx
      .list()
      .then((list) => {
        if (live) setInstalled(list)
      })
      .catch((err: unknown) => {
        if (live) {
          setStatus({
            kind: 'error',
            text: `Could not list extensions: ${(err as Error).message}`
          })
        }
      })
    return () => {
      live = false
    }
  }, [])

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setStatus(null)
    try {
      setResults(await window.agweb.vsx.search(q))
    } catch (err) {
      setStatus({ kind: 'error', text: `Search failed: ${(err as Error).message}` })
    } finally {
      setSearching(false)
    }
  }, [query])

  const install = useCallback(
    async (id: string) => {
      setBusy({ id, what: 'install' })
      setStatus(null)
      try {
        const record = await window.agweb.vsx.install(id)
        await registerInstalled(record)
        setStatus({
          kind: 'ok',
          text:
            needsExtensionHost(record) && !extensionHostStarted
              ? `Installed ${record.displayName} ${record.version}. Its code runs in the extension host, which starts with the next reload.`
              : `Installed ${record.displayName} ${record.version}`
        })
        await refresh()
      } catch (err) {
        setStatus({ kind: 'error', text: `Install failed: ${(err as Error).message}` })
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  const uninstall = useCallback(
    async (id: string) => {
      setBusy({ id, what: 'uninstall' })
      setStatus(null)
      try {
        await window.agweb.vsx.uninstall(id)
        await unregisterInstalled(id)
        setStatus({ kind: 'ok', text: `Removed ${id}` })
        await refresh()
      } catch (err) {
        setStatus({ kind: 'error', text: `Uninstall failed: ${(err as Error).message}` })
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  const installedIds = new Set(installed.map((e) => e.id))

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <form
        className="flex flex-none items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-800"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Open VSX — themes, keymaps, grammars, tools…"
          aria-label="Search extensions"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="flex-none rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b0f14]"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {status && (
        <div
          role="status"
          className={`flex-none border-b px-2 py-1 text-[11px] ${
            status.kind === 'error'
              ? 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300'
              : 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'
          }`}
        >
          {status.text}
        </div>
      )}
      {!extensionHostStarted && installed.some(needsExtensionHost) && (
        <div
          className="flex flex-none items-center gap-2 border-b border-amber-200 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-900 dark:text-amber-300"
          data-testid="ext-host-reload"
        >
          <span className="min-w-0 flex-1">
            An installed extension has code to run; the extension host starts with a reload.
          </span>
          <button
            type="button"
            onClick={() => void window.agweb.windows.reload()}
            className="flex-none rounded-md border border-amber-300 px-2 py-0.5 font-semibold dark:border-amber-700"
          >
            Reload
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {results.length > 0 && (
          <section>
            <h3 className="sticky top-0 bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-[#0b0f14]/90 dark:text-slate-400">
              Results
            </h3>
            <ul>
              {results.map((ext) => (
                <li
                  key={ext.id}
                  data-ext-id={ext.id}
                  className="flex items-start gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800/60"
                >
                  {/* A lettered mark, not the registry's icon: the renderer's CSP
                      is img-src 'self' data: and stays that way — no remote
                      image loads from a shell that holds the core token. */}
                  <div
                    aria-hidden="true"
                    className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded bg-slate-200 text-[11px] font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                  >
                    {(ext.displayName || ext.id).charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {ext.displayName}{' '}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {ext.id} · v{ext.version}
                        {ext.verified ? ' · verified' : ''}
                      </span>
                    </div>
                    <div className="truncate text-slate-600 dark:text-slate-300">
                      {ext.description}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {ext.downloadCount.toLocaleString()} downloads
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null || installedIds.has(ext.id)}
                    onClick={() => void install(ext.id)}
                    className="flex-none rounded-md border border-sky-500 px-2 py-0.5 text-[11px] font-semibold text-sky-700 disabled:opacity-50 dark:text-sky-300"
                  >
                    {installedIds.has(ext.id)
                      ? 'Installed'
                      : busy?.id === ext.id
                        ? 'Installing…'
                        : 'Install'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="sticky top-0 bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur dark:bg-[#0b0f14]/90 dark:text-slate-400">
            Installed ({installed.length})
          </h3>
          {installed.length === 0 ? (
            <p className="px-2 py-3 text-slate-500 dark:text-slate-400">
              No editor extensions yet. Search Open VSX above — themes and keymaps load instantly;
              extensions with code run in an isolated extension host.
            </p>
          ) : (
            <ul>
              {installed.map((ext) => (
                <li
                  key={ext.id}
                  className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {ext.displayName}{' '}
                      <span className="font-normal text-slate-500 dark:text-slate-400">
                        {ext.id} · v{ext.version}
                        {isRegistered(ext.id) ? '' : ' · not loaded'}
                        {isWebCapable(ext) ? '' : ' · desktop-only: its code cannot run here'}
                        {isWebCapable(ext) && (
                          <span data-testid={`ext-activation-${ext.id}`}>
                            {' · '}
                            {activationLabel(ext, activation[ext.id.toLowerCase()])}
                          </span>
                        )}
                      </span>
                    </div>
                    {activation[ext.id.toLowerCase()]?.errors.length ? (
                      <div className="truncate text-rose-600 dark:text-rose-400">
                        {activation[ext.id.toLowerCase()].errors[0]}
                      </div>
                    ) : null}
                    <div className="truncate text-slate-600 dark:text-slate-300">
                      {ext.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void uninstall(ext.id)}
                    className="flex-none rounded-md border border-slate-300 px-2 py-0.5 text-[11px] disabled:opacity-50 dark:border-slate-700"
                  >
                    {busy?.id === ext.id && busy.what === 'uninstall' ? 'Removing…' : 'Uninstall'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
