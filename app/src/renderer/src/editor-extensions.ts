import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions'
import { getService, IExtensionService } from '@codingame/monaco-vscode-api/services'
import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions'
import {
  localizeManifest,
  type ITranslations
} from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionNls'
import type { ILogger } from '@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log'
import extHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url'
import type { VsxInstalled } from '@shared/ipc'

/**
 * VS Code editor extensions from Open VSX (task 12.8) — the renderer half.
 *
 * The core downloads, unpacks and stores extensions; this file makes VS Code's
 * services see them. Two kinds:
 *
 * - **Declarative** extensions (themes, grammars, snippets, keymaps, icon
 *   themes) are pure `contributes` data. The workbench's own services read them
 *   through the file service, so registering the manifest plus the files is
 *   the whole job. No code runs, no extension host is needed.
 * - **Code** extensions activate in VS Code's web-worker extension host. That
 *   host lives in an iframe on the core's loopback origin — a second,
 *   unprivileged origin, cross-origin from `chrome://webdeck` which holds the
 *   core token. `extensionHostOrigin()` points the host there before the
 *   services boot; if the origin is unavailable the worker host stays off and
 *   only declarative extensions load.
 *
 * Files reach the workbench as `data:` URIs. `chrome://webdeck`'s CSP forbids
 * fetching the loopback origin (connect-src), but allows `data:` — and the
 * bytes come over the core's WebSocket, path-contained to the extension.
 */

/** The labels VS Code's web-worker service asks `getWorkerUrl` about. */
const IFRAME_LABEL = 'webWorkerExtensionHostIframe'
const WORKER_LABEL = 'extensionHostWorkerMain'
/** Total bytes of extension files held as data: URIs across all extensions. */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024
/** Files per extension; a bundled extension needs a handful, not a node_modules. */
const MAX_FILES = 2000
const AGWEB_WAIT_MS = 15_000

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.plist': 'text/plain',
  '.tmLanguage': 'text/plain',
  '.tmTheme': 'text/plain',
  '.wasm': 'application/wasm'
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  return (dot >= 0 && MIME[path.slice(dot)]) || 'application/octet-stream'
}

/** `window.agweb` is installed by main.tsx after the core connects; wait for it. */
async function waitForAgweb(): Promise<boolean> {
  const by = Date.now() + AGWEB_WAIT_MS
  while (Date.now() < by) {
    if (window.agweb?.vsx) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

let hostOrigin: string | null = null

/**
 * Resolve the loopback origin the extension host runs on and remember it —
 * or null when it cannot be provided, which callers must treat as "worker
 * host off".
 */
export async function extensionHostOrigin(): Promise<string | null> {
  try {
    if (!(await waitForAgweb())) return null
    hostOrigin = (await window.agweb.vsx.hostOrigin()) || null
    return hostOrigin
  } catch {
    return null
  }
}

/**
 * The URL for one of the extension host's two files, on the loopback origin.
 * Wired into `MonacoEnvironment.getWorkerUrl` (monaco.ts): that is the one
 * seam VS Code's web-worker service consults before its own bundled URL —
 * `registerAssets` is NOT enough, the host takes the bundler URL directly.
 *
 * Both files are served from the bundle's assets/ dir, which is what the
 * loopback exposes under /assets/. The iframe page's CSP allows only 'self'
 * for scripts, so the worker must come from the same origin as the iframe.
 * Only the basename carries over: the bundler URL is on the shell's origin.
 */
/**
 * The bundled worker is an ES module (vite `worker.format: 'es'`), and the
 * host's iframe page only `import()`s it when told so — otherwise it
 * `importScripts()` the file and dies on the first `import.meta`.
 */
export function extensionHostWorkerOptions(label: string): WorkerOptions | undefined {
  return label === WORKER_LABEL ? { type: 'module' } : undefined
}

export function extensionHostFileUrl(label: string): string | undefined {
  if (!hostOrigin) return undefined
  if (label === IFRAME_LABEL) return `${hostOrigin}/assets/webWorkerExtensionHostIframe.html`
  if (label === WORKER_LABEL) {
    const path = new URL(extHostWorkerUrl, location.href).pathname
    return `${hostOrigin}/assets/${path.slice(path.lastIndexOf('/') + 1)}`
  }
  return undefined
}

const registered = new Map<string, { dispose(): Promise<void> }>()
let totalBytes = 0

// Fired after an extension is registered or removed, so surfaces built on the
// installed set (the theme picker, the palette's command list, the Add-block
// menu) refresh without a restart.
const changeListeners = new Set<() => void>()
export function onEditorExtensionsChanged(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}
function notifyChanged(): void {
  for (const listener of changeListeners) listener()
}

/**
 * The manifest with its `%key%` strings resolved from package.nls.json, the
 * way VS Code's own scanner does before anything reads it. Without this every
 * title an extension contributes — view containers, commands, settings — shows
 * as a raw key in the Add-block menu and the palette.
 */
async function localizedManifest(ext: VsxInstalled): Promise<IExtensionManifest> {
  const manifest = ext.manifest as unknown as IExtensionManifest
  if (!ext.files.includes('package.nls.json')) return manifest
  try {
    const file = await window.agweb.vsx.read(ext.dir, 'package.nls.json')
    if (!file) return manifest
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))
    const translations = JSON.parse(new TextDecoder().decode(bytes)) as ITranslations
    const logger = {
      warn: (message: string) => console.warn(`[editor-extensions] ${message}`),
      error: (message: string) => console.warn(`[editor-extensions] ${message}`)
    } as unknown as ILogger
    return localizeManifest(logger, manifest, translations)
  } catch (err) {
    console.warn(`[editor-extensions] ${ext.id}: package.nls.json unusable: ${String(err)}`)
    return manifest
  }
}

/** Register one installed extension with VS Code's services. */
export async function registerInstalled(ext: VsxInstalled): Promise<void> {
  if (registered.has(ext.id)) return
  const manifest = await localizedManifest(ext)
  const reg = registerExtension(manifest, ExtensionHostKind.LocalWebWorker)
  registered.set(ext.id, reg)

  let count = 0
  for (const rel of ext.files) {
    if (++count > MAX_FILES) {
      console.warn(`[editor-extensions] ${ext.id}: more than ${MAX_FILES} files, rest skipped`)
      break
    }
    const file = await window.agweb.vsx.read(ext.dir, rel)
    if (!file) continue
    const bytes = Math.floor(file.base64.length * 0.75)
    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      console.warn(`[editor-extensions] ${ext.id}: extension file budget exhausted at ${rel}`)
      break
    }
    totalBytes += bytes
    reg.registerFileUrl(`./${rel}`, `data:${mimeFor(rel)};base64,${file.base64}`)
  }
  // Declarative contributions — views, themes, grammars, keybindings — are
  // live as soon as the manifest is registered, so surfaces refresh now. Code
  // contributions arrive when the worker host activates the extension; that
  // can be slow (or never, with the host off), so it must not hold the caller.
  notifyChanged()
  void reg
    .whenReady()
    .then(notifyChanged)
    .catch((err: unknown) => {
      console.warn(`[editor-extensions] ${ext.id}: host activation failed: ${String(err)}`)
    })
}

/** Unregister (after an uninstall) so the workbench drops its contributions. */
export async function unregisterInstalled(id: string): Promise<void> {
  const reg = registered.get(id)
  if (!reg) return
  registered.delete(id)
  await reg.dispose()
  notifyChanged()
}

export function isRegistered(id: string): boolean {
  return registered.has(id)
}

/** Load everything the core has installed. Returns how many registered. */
export async function loadInstalledExtensions(): Promise<number> {
  if (!window.agweb?.vsx) return 0
  let installed: VsxInstalled[]
  try {
    installed = await window.agweb.vsx.list()
  } catch {
    return 0
  }
  let loaded = 0
  for (const ext of installed) {
    try {
      await registerInstalled(ext)
      loaded++
    } catch (err) {
      console.warn(`[editor-extensions] ${ext.id} failed to load: ${(err as Error).message}`)
    }
  }
  return loaded
}

/** What the extension host reports for one extension: did its code run, and how it went. */
export interface ExtensionActivation {
  /** The host has started (or finished) activating it. */
  started: boolean
  /** Time to activate, once known. */
  activateMs?: number
  /** Errors thrown while activating or running. */
  errors: string[]
  /** The host's own notes — a missing dependency, an unsupported API. */
  messages: string[]
}

/**
 * Activation status by extension id (lowercased), from VS Code's extension
 * service. A declarative extension never starts and that is fine; a code
 * extension that never starts, or starts with an error, is what this shows.
 */
export async function extensionActivations(): Promise<Record<string, ExtensionActivation>> {
  const out: Record<string, ExtensionActivation> = {}
  try {
    const service = await getService(IExtensionService)
    const all = service.getExtensionsStatus()
    for (const [id, status] of Object.entries(all)) {
      const times = status.activationTimes
      out[id.toLowerCase()] = {
        started: status.activationStarted,
        activateMs: times
          ? times.codeLoadingTime + times.activateCallTime + times.activateResolvedTime
          : undefined,
        errors: status.runtimeErrors.map((e) => e.message),
        messages: status.messages.filter((m) => m.type <= 1).map((m) => m.message)
      }
    }
  } catch {
    // Before the services boot there is nothing to report.
  }
  return out
}
