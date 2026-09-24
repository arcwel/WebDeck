#!/usr/bin/env node
// Drives the built Chromium fork end to end: launches it, loads chrome://webdeck,
// waits for the real UI bundle to mount, and asserts the app is actually working
// — the core socket connected, the blocks answering, no console errors.
//
// This is the integration test the unit tests cannot be: everything below has a
// unit test that passes, and the app can still be broken on the fork because the
// resource pipeline served a stale bundle, the CSP blocked the socket, or a
// channel has no handler. Only running the real browser proves otherwise.
//
// Usage:
//   node scripts/verify-fork.mjs [--browser <path>] [--json] [--screenshot <png>]
//                                [--keep-open] [--timeout <ms>]
// Exit codes: 0 pass · 1 the fork is broken · 2 could not run the check
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { builtAppBinary } from './chromium-src.mjs'

const DEFAULT_BROWSER = builtAppBinary()
const DEBUG_PORT = 9333

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`verify-fork — prove chrome://webdeck works in the built browser

  --browser <path>     the built binary (default: the BG_Dev component build)
  --json               machine-readable result
  --screenshot <png>   save a screenshot of the loaded UI
  --keep-open          leave the browser running after the check
  --timeout <ms>       per-step timeout (default 30000)

  --headless           run headless (default: a real window, which is what
                       users get — a window-only crash is invisible headless)

Exit: 0 pass · 1 fork broken · 2 could not run`)
  process.exit(0)
}

const browser = arg('browser', DEFAULT_BROWSER)
const downloadDir = mkdtempSync(join(tmpdir(), 'wd-fork-downloads-'))
const timeout = Number(arg('timeout', '30000'))
const asJson = flag('json')

/** Fail with exit 2: we could not run the check, which is NOT a pass. */
function cannotRun(message) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason: message }, null, 2))
  else console.error(`cannot run: ${message}`)
  process.exit(2)
}

if (!existsSync(browser)) {
  cannotRun(`no browser at ${browser} — build it first, or pass --browser`)
}

/** Poll the DevTools endpoint until the browser is listening. */
async function waitForDevTools(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      // not up yet
    }
    await sleep(250)
  }
  throw new Error(`DevTools did not listen on ${DEBUG_PORT}`)
}

/** Minimal CDP client over the page's WebSocket — no dependency on a CDP lib. */
async function connect(wsUrl) {
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 })
  const pending = new Map()
  const events = []
  let id = 0

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(msg.error.message))
      else entry.resolve(msg.result)
    } else {
      events.push(msg)
    }
  })

  return {
    events,
    send(method, params = {}) {
      const messageId = ++id
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject })
        ws.send(JSON.stringify({ id: messageId, method, params }))
        setTimeout(() => {
          if (pending.delete(messageId)) reject(new Error(`${method} timed out`))
        }, timeout)
      })
    },
    close: () => ws.close()
  }
}

/** Evaluate an expression in the page and return its value. */
async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return res.result.value
}

/** Poll an expression in the page until it is truthy. */
async function waitFor(cdp, expression, deadline, what) {
  let last
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression)
      if (last) return last
    } catch (err) {
      last = err.message
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`)
}

const checks = []
const record = (name, ok, detail) => checks.push({ name, ok, detail })

let child
try {
  child = spawn(
    browser,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--allow-chrome-scheme-url', // --headless refuses chrome:// without it
      // Headless ONLY when asked. Defaulting to it is how a crash that only
      // happens in a window survived every check: the UI thread's ban on
      // blocking is not armed headless, so chrome://webdeck starting the core
      // inline passed here and killed the browser for a real user.
      ...(flag('headless') ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      // Mock the OS keychain. Headless / non-interactive sessions cannot unlock
      // the login keychain, so the cookie store's OSCrypt "Safe Storage" key
      // fetch blocks forever — which stalls every cookie-reading request,
      // including the shell's WebSocket to the core, so chrome://webdeck never
      // boots. The keychain is a runtime OS resource, not what this check tests.
      '--use-mock-keychain',
      '--user-data-dir=/tmp/webdeck-verify-fork',
      'chrome://webdeck'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
} catch (err) {
  cannotRun(`could not launch the browser: ${err.message}`)
}

const stderr = []
child.stderr.on('data', (d) => stderr.push(String(d)))

let cdp
let exitCode = 0
try {
  const deadline = Date.now() + timeout
  const version = await waitForDevTools(deadline)
  record('browser launches', true, version['User-Agent'])

  // Find the chrome://webdeck target, opening it if the browser did not.
  // Windowed Chromium ignores a chrome:// URL passed on the command line and
  // shows the new-tab page instead, so relying on the argument made this check
  // pass only in headless — the mode that also hid the startup crash.
  const findPage = async () =>
    (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) =>
      String(t.url).startsWith('chrome://webdeck')
    )
  let page = await findPage()
  if (!page) {
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?chrome://webdeck`, { method: 'PUT' })
    const openedBy = Date.now() + timeout
    while (!page && Date.now() < openedBy) {
      await sleep(300)
      page = await findPage()
    }
  }
  if (!page) throw new Error('chrome://webdeck never appeared as a target')
  record('chrome://webdeck loads', true, page.url)

  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')

  // 1. The React app actually mounted — not a blank page or an error page.
  await waitFor(
    cdp,
    'document.querySelector(".wd-shell") !== null',
    Date.now() + timeout,
    'the WebDeck shell to mount'
  )
  record('UI bundle mounts', true, '.wd-shell present')

  // 2. The API surface is installed and reports the right host. WebDeck owns
  //    the window on the fork: Chromium draws no tab strip or toolbar, the
  //    shell draws its own glass chrome and drives the real tab over the Mojo
  //    Shell — so ownsBrowserChrome is FALSE here by design (webui/main.tsx),
  //    while downloads, zoom and find stay Chromium's (ownsBrowserFeatures).
  const host = await evaluate(cdp, 'JSON.stringify(window.agweb?.host ?? null)')
  const parsedHost = host ? JSON.parse(host) : null
  const hostOk =
    parsedHost?.kind === 'chromium' &&
    parsedHost?.ownsBrowserChrome === false &&
    parsedHost?.ownsBrowserFeatures === true
  record('host reports chromium (shell draws the chrome)', hostOk, host)
  if (!hostOk) exitCode = 1

  // 3. Exactly one shell chrome — the page's own. Zero would mean the tab
  //    strip is missing; two would mean it is drawn twice.
  const chromeNodes = await evaluate(cdp, 'document.querySelectorAll(".wd-chrome").length')
  record('exactly one shell chrome', chromeNodes === 1, `${chromeNodes} .wd-chrome nodes`)
  if (chromeNodes !== 1) exitCode = 1

  // 4. The core socket answers — the whole point of the fork build.
  const appInfo = await waitFor(
    cdp,
    'window.agweb.getAppInfo().then(i => JSON.stringify(i)).catch(e => false)',
    Date.now() + timeout,
    'webdeck-core to answer app:info'
  )
  record('webdeck-core connected', true, appInfo)

  // 5. Every block's backend answers. This is the check that caught Preview
  //    (devserver:*) and Reveal.js (slides:open) being unregistered.
  const blockProbe = `(async () => {
    const out = {}
    const probes = {
      Policy: () => window.agweb.policy.get(),
      Settings: () => window.agweb.settings.read(),
      Agent: () => window.agweb.agents.list(),
      'Agent key': () => window.agweb.agents.keyStatus(),
      Secrets: () => window.agweb.secrets.list(),
      Sync: () => window.agweb.sync.status(),
      Preview: () => window.agweb.devServer.status(),
      Workspace: () => window.agweb.getCurrentWorkspace(),
      Files: () => window.agweb.fs.list(''),
      'Source Control': () => window.agweb.git.status(),
      Tasks: () => window.agweb.tasks.list(),
      Search: () => window.agweb.search('webdeck'),
      Debug: () => window.agweb.debug.available(),
      Profiles: () => window.agweb.profiles.list(),
      Downloads: () => window.agweb.downloads.list()
    }
    for (const [name, fn] of Object.entries(probes)) {
      try { await fn(); out[name] = 'ok' } catch (e) { out[name] = 'FAILED: ' + e.message }
    }
    return JSON.stringify(out)
  })()`
  const blocks = JSON.parse(await evaluate(cdp, blockProbe))
  const failedBlocks = Object.entries(blocks).filter(([, v]) => v !== 'ok')
  record('block backends answer', failedBlocks.length === 0, JSON.stringify(blocks))
  if (failedBlocks.length > 0) exitCode = 1

  // 6. Opening a project actually works. Under the fork there is no native
  //    folder picker, so the start page offers a path instead — and a path box
  //    that does not open the project is no better than the dead button it
  //    replaced. Drive it the way a user would: type, press Open, check the
  //    workspace changed.
  const probeDir = mkdtempSync(join(tmpdir(), 'wd-fork-open-'))
  writeFileSync(join(probeDir, 'README.md'), '# probe\n')
  const opened = await evaluate(
    cdp,
    `(async () => {
      const ws = await window.agweb.openWorkspacePath(${JSON.stringify(probeDir)})
      if (!ws) return 'FAILED: openWorkspacePath returned nothing'
      const files = await window.agweb.fs.list('')
      return files.some(f => f.name === 'README.md')
        ? 'ok:' + ws.name
        : 'FAILED: workspace opened but does not list its files'
    })()`
  )
  record('opens a project by path', String(opened).startsWith('ok:'), String(opened))
  if (!String(opened).startsWith('ok:')) exitCode = 1
  rmSync(probeDir, { recursive: true, force: true })

  // 7. No console errors. A CSP violation or a failed asset shows up here and
  //    nowhere else — the page still renders, just wrong.
  const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
    .map((e) => e.params.entry.text)
  record('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
  if (consoleErrors.length > 0) exitCode = 1

  // 7. Export actually produces a file. A chrome:// page has restrictions a
  //    normal page does not, so "the code compiles" says nothing about whether
  //    a Blob download is permitted here — the only way to know is to do one
  //    and watch for the download to begin.
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true
  })
  const exported = await evaluate(
    cdp,
    `window.agweb.exports
      .html('<!doctype html><h1>verify</h1>', 'verify-export.html')
      .then(r => JSON.stringify(r))
      .catch(e => 'FAILED: ' + e.message)`
  )
  // Give the download a moment to land.
  await sleep(1500)
  const wrote = existsSync(join(downloadDir, 'verify-export.html'))
  record('exports a file', wrote, wrote ? String(exported) : `no file written (${exported})`)
  if (!wrote) exitCode = 1

  // The browser must still be running. chrome://webdeck once crashed the
  // browser on load (a DCHECK for blocking the UI thread); every check above
  // can pass against a process that is already dying, so ask explicitly.
  if (child.exitCode !== null || child.signalCode !== null) {
    record(
      'browser survives loading the page',
      false,
      `exited ${child.exitCode ?? child.signalCode}`
    )
    exitCode = 1
  } else {
    const stillThere = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      .then((r) => r.ok)
      .catch(() => false)
    record('browser survives loading the page', stillThere, stillThere ? 'still serving' : 'gone')
    if (!stillThere) exitCode = 1
  }

  const shot = arg('screenshot')
  if (shot) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(shot, Buffer.from(data, 'base64'))
    record('screenshot saved', true, shot)
  }
} catch (err) {
  record('verification', false, err.message)
  if (asJson) {
    console.log(JSON.stringify({ status: 'error', reason: err.message, checks }, null, 2))
  } else {
    console.error(`cannot run: ${err.message}`)
    if (stderr.length) console.error(stderr.join('').split('\n').slice(-10).join('\n'))
  }
  cdp?.close()
  if (!flag('keep-open')) child.kill()
  process.exit(2)
}

cdp?.close()
if (!flag('keep-open')) child.kill()

if (asJson) {
  console.log(JSON.stringify({ status: exitCode === 0 ? 'pass' : 'fail', checks }, null, 2))
} else {
  for (const c of checks)
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  console.log(
    exitCode === 0 ? '\nThe fork works.' : '\nThe fork is broken — see the ✗ lines above.'
  )
}
process.exit(exitCode)
