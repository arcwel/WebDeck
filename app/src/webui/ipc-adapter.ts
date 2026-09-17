import { CoreClient } from '../core/transports/ws-client'
import type { IpcLike } from './agweb-api'
import { exportCapture, exportHtml, exportPdf } from './export'
import { confirmDialog, pickJsonFile, pickPaths, unavailableHere } from './pickers'
import { SHELL_BROWSER, SHELL_BROWSER_EVENTS, onShellBrowserEvent } from './shell'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings } from '@shared/ipc'

/**
 * Makes a `webdeck-core` WebSocket look like Electron's `ipcRenderer`.
 *
 * This is the whole trick behind running the real UI under the Chromium fork:
 * `createAgwebApi()` builds the identical `window.agweb` surface from whatever
 * transport it is handed, so the renderer above it cannot tell the difference.
 *
 * Two shapes need translating:
 *
 * - **Events.** Electron delivers `(event, ...args)`; the core pushes one JSON
 *   payload. The preload's handlers all read `(_event, payload)`, so we pass a
 *   `null` event and the payload through unchanged.
 * - **`sendSync`.** There is exactly one synchronous call in the surface
 *   (`appSettings.readSync`, used during boot before React renders) and a socket
 *   cannot answer synchronously. We prefetch that value at startup and serve it
 *   from cache — see `primeSyncCache`.
 */

/** Channels answered from cache because the caller needs them synchronously. */
const syncCache = new Map<string, unknown>()

/** Fetch the values `sendSync` will be asked for, before the UI mounts. */
export async function primeSyncCache(client: CoreClient): Promise<void> {
  try {
    const settings = (await client.invoke(IpcChannels.appSettingsRead)) as AppSettings
    syncCache.set(IpcChannels.appSettingsReadSync, settings)
  } catch {
    // Left unset: readSync falls back to defaults below rather than throwing
    // during boot, which would take the whole UI down.
  }
}

/** Last-resort defaults, so a cold cache degrades instead of crashing the boot. */
const FALLBACK_SETTINGS: AppSettings = {
  hardwareAcceleration: true,
  spellcheck: true,
  spellcheckLanguages: ['en-US'],
  askForPermissions: true,
  doNotTrack: false,
  restoreTabs: true,
  downloadPath: '',
  askWhereToSave: false,
  searchEngine: 'duckduckgo',
  showAskButton: true,
  profileImage: '',
  customEditorsOpenIn: 'browser',
  toolbarHidden: []
}

/**
 * Channels the *browser* owns, not the core.
 *
 * Under Electron the shell implemented tabs, downloads, zoom and the embed proxy
 * itself. Under the fork those are Chromium's own features, reached through the
 * browser's UI rather than ours — so the core has no handler and never will.
 * Returning a benign empty value keeps the Deck working instead of filling the
 * console with rejections for features that have simply moved.
 *
 * This is a *known* list rather than a catch-all: an unknown channel still
 * rejects loudly, because that means a real wiring bug.
 */
export const SHELL_OWNED: Record<string, (...args: unknown[]) => unknown> = {
  [IpcChannels.downloadsList]: () => [],
  [IpcChannels.downloadsShow]: () => undefined,
  [IpcChannels.downloadsClear]: () => undefined,
  [IpcChannels.proxyStatus]: () => ({ enabled: false, allowlist: [] }),
  [IpcChannels.proxySetEnabled]: () => ({ enabled: false, allowlist: [] }),
  [IpcChannels.browserZoom]: () => 0,
  // Sign-in is Chromium's on this build: the profile button reads the account
  // from the Shell (profiles:account), so the per-profile Google map Electron
  // kept has nobody to fill it. Empty, not an error — the toolbar asks for it
  // whenever its menu opens.
  [IpcChannels.profilesGoogleStatus]: () => ({}),
  [IpcChannels.extList]: () => [],
  // Chromium installs, lists and removes extensions itself, at
  // chrome://extensions — there is no unpacked-from-a-path load for us to
  // offer, and the Toolbar that offered it is not drawn on this host at all.
  // The result shape has an `error`, so this one can say so in its own answer.
  [IpcChannels.extLoadPath]: () => ({
    error:
      'Chromium manages extensions on this build — install or remove them at chrome://extensions.'
  }),
  // Document Studio exports. The browser saves files and prints to PDF itself,
  // so these never reach the core — see webui/export.ts.
  [IpcChannels.exportHtml]: (html, name) => exportHtml(String(html), String(name)),
  [IpcChannels.exportPdf]: (html, name) => exportPdf(String(html), String(name)),
  [IpcChannels.exportCapture]: (_rect, name) => exportCapture(String(name)),
  // Dialogs. confirm() is the browser's own — the same one Electron wrapped.
  // File choosers hand back CONTENT, never a path, so the channels that need a
  // path say so rather than inventing one. See webui/pickers.ts.
  [IpcChannels.dialogConfirm]: (message) => confirmDialog(String(message)),
  // Both of these are answered BEFORE this table is consulted: paths come from
  // the Shell's native panel (SHELL_BROWSER dialogPickPaths → Shell.pickPaths),
  // and workspace:open is the picker plus the core's open-by-path (see
  // createWebUiIpc). They stay listed so the channel coverage check sees them
  // served; reaching either entry means the Shell route was removed.
  [IpcChannels.dialogPickPaths]: () => pickPaths(),
  [IpcChannels.workspaceOpen]: () =>
    unavailableHere('workspace:open is answered by the native folder panel (Shell.pickPaths).'),
  // Answers with the settings and has no error field, so a returned value would
  // read as "the user cancelled". The UI branches on host.ownsBrowserFeatures
  // instead of calling it, so a rejection here means a wiring bug.
  [IpcChannels.appSettingsChooseDownloadDir]: () =>
    unavailableHere(
      'Chromium owns the download location on this build — change it at chrome://settings/downloads.'
    ),
  [IpcChannels.settingsImport]: () => pickJsonFile(),
  [IpcChannels.bookmarksImportFile]: () => pickJsonFile(),
  [IpcChannels.syncChooseFile]: () => pickJsonFile(),
  [IpcChannels.profilesList]: () => ({ profiles: [], activeId: '' }),
  // The page follows the browser's own theme; nativeTheme is not ours to set.
  [IpcChannels.themeSet]: () => undefined
}

export function createWebUiIpc(client: CoreClient): IpcLike {
  // Electron hands listeners an event object first; the core sends only the
  // payload, so each listener needs a wrapper — and removeListener has to find
  // the same wrapper again to unsubscribe it.
  //
  // A LIST per (channel, listener), not a single entry: Electron lets the same
  // function subscribe twice and fire twice, and removeListener takes one off.
  // Keeping only the newest wrapper made the older subscription unreachable —
  // it fired forever and no removeListener could ever detach it.
  const wrappers = new Map<string, Map<unknown, Array<(payload: unknown) => void>>>()
  const unsubscribes = new Map<(payload: unknown) => void, () => void>()

  return {
    invoke: (channel, ...args) => {
      // When WebDeck owns the window, the browser.* channels drive the real tab
      // over the Mojo Shell rather than the core (which does not own tabs).
      // Own-property guards: SHELL_BROWSER/SHELL_OWNED are plain object literals,
      // so a channel like 'constructor'/'toString'/'__proto__' would otherwise
      // resolve to an inherited Object.prototype member and be treated as a
      // handler. hasOwn ensures only real, declared channels dispatch to the
      // Shell — an unknown channel falls through to the core, as intended.
      const browser = Object.hasOwn(SHELL_BROWSER, channel) ? SHELL_BROWSER[channel] : undefined
      if (browser) return browser(...args)
      // "Open a project" is two steps here: the browser's native folder panel
      // (Shell.pickPaths, which reports a real path) and then the core's
      // open-by-path. Electron did both in one main-process handler; the fork
      // splits them across the Shell and the core, so this is the one channel
      // that needs both. A cancelled panel answers null, like Electron's did.
      if (channel === IpcChannels.workspaceOpen) {
        return (SHELL_BROWSER[IpcChannels.dialogPickPaths]('dir') as Promise<string[]>).then(
          (paths) => (paths.length ? client.invoke(IpcChannels.workspaceOpenPath, paths[0]) : null)
        )
      }
      const shell = Object.hasOwn(SHELL_OWNED, channel) ? SHELL_OWNED[channel] : undefined
      // Arguments are forwarded: some shell-owned channels (the exports) need
      // them, and silently dropping them made every handler look argument-free.
      if (shell) return Promise.resolve(shell(...args))
      return client.invoke(channel, ...args)
    },

    send: (channel, ...args) => {
      // Fire-and-forget: the registry's notify path.
      void client.notify(channel, ...args)
    },

    sendSync: (channel) => {
      if (syncCache.has(channel)) return syncCache.get(channel)
      if (channel === IpcChannels.appSettingsReadSync) return FALLBACK_SETTINGS
      return undefined
    },

    on: (channel, listener) => {
      const wrapped = (payload: unknown): void => listener(null, payload)
      let perChannel = wrappers.get(channel)
      if (!perChannel) {
        perChannel = new Map()
        wrappers.set(channel, perChannel)
      }
      const existing = perChannel.get(listener)
      if (existing) existing.push(wrapped)
      else perChannel.set(listener, [wrapped])
      // Browser state events come from the browser over the Mojo ShellClient,
      // not the core — deliver those through the shell's local bus. Both return
      // an unsubscribe, so removeListener stays uniform.
      unsubscribes.set(
        wrapped,
        SHELL_BROWSER_EVENTS.has(channel)
          ? onShellBrowserEvent(channel, wrapped)
          : client.on(channel, wrapped)
      )
      return undefined
    },

    removeListener: (channel, listener) => {
      const perChannel = wrappers.get(channel)
      const list = perChannel?.get(listener)
      if (!perChannel || !list?.length) return undefined
      const wrapped = list.pop() as (payload: unknown) => void
      if (!list.length) perChannel.delete(listener)
      unsubscribes.get(wrapped)?.()
      unsubscribes.delete(wrapped)
      return undefined
    }
  }
}
