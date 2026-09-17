import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import { DeckWindow } from '@/components/DeckWindow'
import { FloatWindow } from '@/components/FloatWindow'
import { useShellSync } from '@/windowSync'
import { getWindowRole, useShellStore } from '@/store'
import { loadInitialTheme } from '@/theme'
import { installShortcutListener } from '@/shortcuts'
import { coreAuthSubprotocol } from '../core/transports/auth'
import { CoreClient } from '../core/transports/ws-client'
import { serveAgentTabs } from './agent-tabs'
import { createAgwebApi } from './agweb-api'
import { createWebUiIpc, primeSyncCache } from './ipc-adapter'
import { htmlSinksAllowed } from '@/trusted-html'
import '@/styles.css'

/**
 * `chrome://webdeck` entry point — the real WebDeck UI, running under the fork.
 *
 * The difference from the Electron renderer is one line of plumbing: instead of
 * a preload injecting `window.agweb` over IPC, we build the *same* API here from
 * a WebSocket to `webdeck-core`. Everything above this file — the store, the
 * Deck, every block — is unchanged and unaware.
 *
 * The port is handed over by the WebUI host as `window.WEBDECK_CORE_PORT` (see
 * `WebDeckUI`), or `?corePort=` when driving the page by hand. The connection
 * token arrives the same way, as `window.WEBDECK_CORE_TOKEN` — see `coreToken`.
 */

declare global {
  interface Window {
    WEBDECK_CORE_PORT?: number
    /**
     * The core's per-boot connection secret, emitted by the WebUI host in
     * `core-port.js` beside the port. Optional in the type because the C++ that
     * emits it lands separately; a page without it simply gets refused by the
     * core, which is the correct outcome.
     */
    WEBDECK_CORE_TOKEN?: string
    __WEBDECK_ASSETS?: Record<string, string>
    /** Trusted Types factory (lib.dom does not declare it yet). */
    trustedTypes?: {
      createPolicy(
        name: string,
        rules: {
          createScriptURL?: (input: string) => string
          createHTML?: (input: string) => string
        }
      ): unknown
    }
  }
}

/**
 * Serve bundled text assets from the inlined map instead of the network.
 *
 * Chromium refuses `fetch()` on chrome:// URLs from page script, so the VS Code
 * service layer cannot read its own bundled themes and grammars once they are
 * served from the WebUI pak — it fails with "URL scheme chrome is not
 * supported" and falls back to an unstyled editor. The build emits those files
 * into `window.__WEBDECK_ASSETS` (see vite.webui.config.ts) and this answers
 * from there; everything else falls through to the real fetch untouched.
 */
function installAssetFetchShim(): void {
  const assets = window.__WEBDECK_ASSETS
  if (!assets) return
  const realFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const match = /\/(assets\/[^/?#]+)(?:[?#]|$)/.exec(url ?? '')
    const body = match ? assets[match[1]] : undefined
    if (body === undefined) return realFetch(input as RequestInfo, init)
    return Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    )
  }
}

/**
 * Trusted Types: the page runs under `require-trusted-types-for 'script'`, so
 * every script-URL sink — `new Worker(url)` above all — needs a policy. Monaco
 * and VS Code's worker host build their worker URLs as plain strings, so a
 * *default* policy is the one place to vet them: only this origin's own bundle
 * and same-origin blobs pass; anything else is refused at the sink, which is
 * exactly the guarantee the CSP directive exists to give.
 *
 * HTML strings are refused too, with one door (trusted-html.ts): a library
 * that must render to markup in a scratch element, mermaid, is let through
 * for the duration of its render and nothing else. What it renders is still
 * parsed, scrubbed and inserted as nodes, never as the string.
 */
function installTrustedTypesPolicy(): void {
  const tt = window.trustedTypes
  if (!tt) return
  const own = `${location.origin}/`
  const ownBlob = `blob:${location.origin}/`
  try {
    tt.createPolicy('default', {
      createScriptURL: (url: string) => {
        if (url.startsWith(own) || url.startsWith(ownBlob)) return url
        throw new TypeError(`Refused script URL outside chrome://webdeck: ${url.slice(0, 120)}`)
      },
      createHTML: (html: string) => {
        if (htmlSinksAllowed()) return html
        throw new TypeError('Refused an HTML string: chrome://webdeck inserts nodes, not markup')
      }
    })
  } catch {
    // A default policy already exists (only possible if this ran twice).
  }
}

function corePort(): number {
  const fromQuery = Number(new URLSearchParams(location.search).get('corePort'))
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery
  return typeof window.WEBDECK_CORE_PORT === 'number' ? window.WEBDECK_CORE_PORT : 0
}

/**
 * The secret that lets this page drive the core.
 *
 * Only from the host global — never from the query string. A URL is the part of
 * a request that ends up in logs, history and copy-pasted bug reports, and this
 * token is worth as much as the user's shell.
 *
 * Absence is tolerated rather than thrown on: the WebUI host's `core-port.js`
 * gains this global in a separate (C++) change, and until it does the page
 * should reach the same honest "could not reach webdeck-core" screen as any
 * other refused connection — not a blank page from an exception at import time.
 */
function coreToken(): string {
  return typeof window.WEBDECK_CORE_TOKEN === 'string' ? window.WEBDECK_CORE_TOKEN : ''
}

/**
 * Replace the boot screen with an honest failure, rather than a blank page.
 *
 * `replaceChildren()`, not `innerHTML = ''`: assigning a string to innerHTML is
 * an HTML sink, and the default Trusted Types policy installed above refuses
 * those. So this function — the one that exists to explain a failed boot —
 * threw instead of rendering, and every boot failure became the blank page it
 * was written to prevent.
 */
function fail(message: string, detail: string): void {
  const root = document.getElementById('root')
  if (!root) return
  root.replaceChildren()
  const wrap = document.createElement('div')
  wrap.className = 'webui-fail'
  const h = document.createElement('h1')
  h.textContent = message
  const p = document.createElement('pre')
  p.textContent = detail
  wrap.append(h, p)
  root.append(wrap)
}

async function main(): Promise<void> {
  installTrustedTypesPolicy()
  installAssetFetchShim()
  const port = corePort()
  if (!port) {
    fail(
      'webdeck-core is not running.',
      'The browser did not report a core port. See the browser log for "webdeck-core".'
    )
    return
  }

  // The token rides in the subprotocol argument: a page cannot set request
  // headers on a WebSocket, and it must not ride in the URL. See auth.ts.
  const token = coreToken()
  const protocols = token ? [coreAuthSubprotocol(token)] : []
  const client = new CoreClient({
    connect: () => new WebSocket(`ws://127.0.0.1:${port}`, protocols)
  })
  try {
    await client.connect()
  } catch (error) {
    fail(
      'Could not reach webdeck-core.',
      token
        ? String((error as Error)?.message ?? error)
        : 'The browser did not report a core token, so the connection was refused. ' +
            'See the browser log for "webdeck-core".'
    )
    return
  }

  // Let the core drive the user's own tabs through us. The agent runs in the
  // core; the tabs are reachable only from inside the browser, and this page is
  // the only part of WebDeck that lives there.
  serveAgentTabs(client)

  // Build the shared API surface over the socket and install it exactly where
  // the preload would have.
  window.agweb = createAgwebApi(createWebUiIpc(client), {
    kind: 'chromium',
    // WebDeck owns the window: there is no native tab strip or address bar, so
    // the shell draws its own glass tab strip and toolbar and drives the real
    // tab over the Mojo Shell (see webui/shell.ts). ownsBrowserFeatures stays
    // true — downloads, zoom and find are still Chromium's, reached its own way.
    ownsBrowserChrome: false,
    ownsBrowserFeatures: true,
    // Deck and float windows are real browser windows (Shell.openWindow), and
    // the native open panel reports real paths (Shell.pickPaths) — a privileged
    // shell page may learn where a file lives, so projects open from a folder
    // picker and attachments are referenced in place.
    canOpenWindows: true,
    canPickPaths: true,
    // Export works, done the browser's own way: a download for HTML, the print
    // preview for PDF. See webui/export.ts.
    canExport: true
  })
  // readSync is consulted during boot, so it must be warm before React mounts.
  await primeSyncCache(client)

  const role = getWindowRole()
  useShellStore.setState({ theme: loadInitialTheme() })
  if (role.kind === 'main') installShortcutListener()

  if (role.kind !== 'main') {
    // A deck or float window is a browser window whose staged tab must stay
    // out of the way: the shell page IS the window. Hide the stage, ask the
    // main window for the current layout, and say goodbye on the way out so
    // the main window docks the deck / group back.
    void window.agweb.browser.setVisible('', false)
    void window.agweb.windows.requestSync()
    window.addEventListener('pagehide', () => {
      void window.agweb.windows.notifyClosed(role.kind === 'deck' ? 'deck' : 'float', role.groupId)
    })
  }

  function Root(): React.JSX.Element {
    useShellSync(role.kind)
    if (role.kind === 'deck') return <DeckWindow />
    if (role.kind === 'float') return <FloatWindow groupId={role.groupId ?? ''} />
    return <App />
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  )
}

void main()
