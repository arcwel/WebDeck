#!/usr/bin/env node
// Proves — or disproves — that the agent can drive the USER'S OWN tabs on the
// fork. The path under test, end to end and with nothing stubbed:
//
//   this script -> webdeck-core (agentBrowserMode: 'session')
//               -> [WebSocket, authenticated, reverse RPC]
//               -> chrome://webdeck page (serveAgentTabs)
//               -> [Mojo AgentTabs] -> browser process -> a real tab
//
// HOW THE CORE UNDER TEST IS ARRANGED (read this before trusting a pass)
//
// The browser spawns its own webdeck-core, and `src/core/main.ts` never passes
// `agentBrowserMode`, so that core is always in ISOLATED mode — it cannot be
// asked for session mode from the command line. Driving it would therefore test
// the wrong port. So this script builds its own core entry point (esbuild, same
// options as scripts/build-core.mjs) that calls the real
// `startWebdeckCore({ agentBrowserMode: 'session' })` from src/core/server.ts,
// and runs it as a child process. Nothing in src/ is modified or re-implemented:
// the port under test is the exact `pageAgentBrowser` the server wires up.
//
// The page is then pointed at THAT core instead of the browser's own. The page
// reads `window.WEBDECK_CORE_PORT` / `window.WEBDECK_CORE_TOKEN` from the
// host-generated `core-port.js`; this script pins both with
// Page.addScriptToEvaluateOnNewDocument before that script runs, so core-port.js
// assigns into a no-op setter. The check then CONFIRMS the page is bound to our
// core, not the browser's, by reading back a unique version marker only our core
// reports (`webdeck-core` sets it from $WEBDECK_VERSION). If that marker does
// not come back, the run aborts with exit 2 rather than measuring the wrong core.
//
// The port's own methods are invoked in the core process through a tiny
// loopback control channel the generated entry point serves (token-guarded,
// 127.0.0.1). It calls `agentBrowser().<method>(...)` — the same singleton the
// agent's tools call — so every assertion below travels the full path above.
//
// Usage:
//   node scripts/verify-session-mode.mjs [--browser <path>] [--json]
//                                        [--keep-open] [--headless]
//                                        [--timeout <ms>]
// Exit codes: 0 pass · 1 the session path is broken · 2 could not run the check
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { builtAppBinary } from './chromium-src.mjs'

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_BROWSER = builtAppBinary()
const DEBUG_PORT = 9334

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`verify-session-mode — prove the agent drives the user's own tabs

  --browser <path>   the built fork (default: the BG_Dev build)
  --json             machine-readable result
  --keep-open        leave the browser and core running after the check
  --headless         run headless (default: a real window, which is what a
                     session-mode agent actually needs — OpenTab refuses when
                     no tabbed browser window exists)
  --timeout <ms>     per-step timeout (default 30000)

Exit: 0 pass · 1 the session path is broken · 2 could not run`)
  process.exit(0)
}

const browserPath = arg('browser', DEFAULT_BROWSER)
const timeout = Number(arg('timeout', '30000'))
const asJson = flag('json')

/** A marker only OUR core reports, so a pass cannot come from the wrong core. */
const CORE_MARKER = `session-verify-${process.pid}-${Date.now()}`
const CONSOLE_MARKER = 'WEBDECK_VISION_PROBE_CONSOLE_ERROR'

const checks = []
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  return ok
}
/** Informational: reported, never counted for or against the exit code. */
const notes = []

const cleanups = []
function cleanup() {
  for (const fn of cleanups.reverse()) {
    try {
      fn()
    } catch {
      // best effort: a failed teardown must not mask the result
    }
  }
}

/** Exit 2: we could not run the check. That is NOT a pass. */
function cannotRun(message) {
  cleanup()
  if (asJson)
    console.log(JSON.stringify({ status: 'error', reason: message, checks, notes }, null, 2))
  else {
    for (const c of checks)
      console.error(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
    console.error(`cannot run: ${message}`)
  }
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Fixtures: the pages the agent will drive.
// ---------------------------------------------------------------------------

const WORK_HTML = `<!doctype html><meta charset="utf-8"><title>work</title>
<h1 id="title">WebDeck session probe</h1>
<input id="field" value="">
<button id="go">Go</button>
<div id="out">idle</div>
<script>
document.getElementById('go').addEventListener('click', function () {
  document.getElementById('out').textContent = 'clicked:' + document.getElementById('field').value
})
</script>`

// A page that fails two ways: a subresource that 500s DURING load, and a second
// 500 plus a console error on a timer AFTER load. Both must show up in the
// vision report; a report that says "no problems" here is the bug.
const VISION_HTML = `<!doctype html><meta charset="utf-8"><title>vision</title>
<h1 id="vision">vision probe</h1>
<img id="broken" src="/boom-load" alt="broken">
<script>
setTimeout(function () {
  fetch('/boom-timer').catch(function () {})
  console.error('${CONSOLE_MARKER}')
}, 700)
</script>`

const redirectHtml = (deniedUrl) => `<!doctype html><meta charset="utf-8"><title>redirect</title>
<h1 id="redirect">about to redirect</h1>
<script>
setTimeout(function () { location.href = ${JSON.stringify(deniedUrl)} }, 800)
</script>`

function startFixtures() {
  let deniedUrl = ''
  const handler = (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const html = (body) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    }
    if (path === '/idle') return html('<!doctype html><title>idle</title><h1 id="idle">idle</h1>')
    if (path === '/work') return html(WORK_HTML)
    if (path === '/vision') return html(VISION_HTML)
    if (path === '/redirect') return html(redirectHtml(deniedUrl))
    if (path === '/boom-load' || path === '/boom-timer') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      return res.end('boom')
    }
    // The denied destination answers slowly on purpose: the guard's stopLoading
    // travels tab -> browser -> page -> socket -> core -> back, so a destination
    // that commits instantly would prove nothing about the cancel.
    if (path === '/denied-destination') {
      setTimeout(() => {
        if (!res.writableEnded)
          html('<!doctype html><title>denied</title><h1 id="arrived">arrived</h1>')
      }, 6000)
      return undefined
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('not found')
  }

  const v4 = createServer(handler)
  return new Promise((resolve, reject) => {
    v4.on('error', reject)
    v4.listen(0, '127.0.0.1', () => {
      const port = v4.address().port
      deniedUrl = `http://localhost:${port}/denied-destination`
      // Same port on ::1 so the denied host resolves whichever family Chromium
      // picks for "localhost". Optional — the guard fires on the request, not
      // the response — so a failure here is not fatal.
      const v6 = createServer(handler)
      v6.on('error', () => resolve({ port, deniedUrl, close: () => v4.close() }))
      v6.listen(port, '::1', () =>
        resolve({
          port,
          deniedUrl,
          close: () => {
            v4.close()
            v6.close()
          }
        })
      )
    })
  })
}

// ---------------------------------------------------------------------------
// The core under test: the real startWebdeckCore, in session mode.
// ---------------------------------------------------------------------------

const HARNESS_ENTRY = `// GENERATED by scripts/verify-session-mode.mjs — do not edit, do not commit.
// Starts the REAL webdeck-core in session mode and exposes the wired
// AgentBrowserPort over a token-guarded loopback control channel, so the
// verifier can invoke the port's own methods inside the core process.
import { createServer } from 'node:http'
import { startWebdeckCore } from '../../src/core/server'
import { agentBrowser } from '../../src/core/agent-browser-port'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const controlToken = process.env.WEBDECK_VERIFY_TOKEN ?? ''
  const handle = await startWebdeckCore({
    port: 0,
    userDataDir: arg('user-data'),
    portFile: arg('port-file'),
    agentBrowserMode: 'session'
  })

  const control = createServer((req, res) => {
    if (req.headers['x-webdeck-verify'] !== controlToken) {
      res.writeHead(403).end('forbidden')
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += String(chunk)
    })
    req.on('end', () => {
      void (async () => {
        const reply = (payload: unknown): void => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(payload))
        }
        try {
          const call = JSON.parse(body || '{}') as { method: string; args?: unknown[] }
          const port = agentBrowser() as unknown as Record<string, (...a: unknown[]) => unknown>
          if (call.method === '__portShape') {
            reply({ ok: true, result: Object.keys(port).sort().join(',') })
            return
          }
          const fn = port[call.method]
          if (typeof fn !== 'function') {
            reply({ ok: false, error: 'no such port method: ' + call.method })
            return
          }
          const value = await fn(...(call.args ?? []))
          reply({ ok: true, result: Buffer.isBuffer(value) ? '<buffer:' + value.length + '>' : value })
        } catch (err) {
          reply({ ok: false, error: (err as Error).message })
        }
      })()
    })
  })
  control.listen(0, '127.0.0.1', () => {
    const address = control.address() as { port: number }
    process.stdout.write(
      JSON.stringify({ ready: true, corePort: handle.port, controlPort: address.port }) + '\\n'
    )
  })

  const stop = (): void => {
    void handle.close().then(() => process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

void main().catch((error: unknown) => {
  process.stderr.write('harness failed: ' + (error as Error).message + '\\n')
  process.exit(1)
})
`

async function buildHarness(outDir) {
  const entry = join(outDir, 'session-core-entry.ts')
  const outfile = join(outDir, 'session-core.cjs')
  writeFileSync(entry, HARNESS_ENTRY, 'utf8')
  const { build } = await import('esbuild')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    define: { 'import.meta.url': '__wdModuleUrl' },
    banner: { js: "const __wdModuleUrl = require('node:url').pathToFileURL(__filename).href;" },
    external: [
      'electron',
      'node-pty',
      'ws',
      '@anthropic-ai/sdk',
      'typescript-language-server',
      'vscode-jsonrpc',
      'vscode-languageclient',
      'js-yaml',
      'smol-toml',
      'papaparse'
    ],
    alias: { '@shared': join(APP_DIR, 'src', 'shared') },
    logLevel: 'silent'
  })
  return outfile
}

// ---------------------------------------------------------------------------
// CDP: enough to drive one page, with no CDP dependency.
// ---------------------------------------------------------------------------

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

async function connect(wsUrl) {
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 })
  const pending = new Map()
  let id = 0
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw))
    if (msg.id === undefined) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error.message))
    else entry.resolve(msg.result)
  })
  return {
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

const targets = async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
const pageUrls = async () =>
  (await targets()).filter((t) => t.type === 'page').map((t) => String(t.url))

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

let exitCode = 0
const workDir = join(APP_DIR, 'out', 'verify-session')
const runtimeDir = mkdtempSync(join(tmpdir(), 'wd-session-'))
cleanups.push(() => rmSync(runtimeDir, { recursive: true, force: true }))

let coreChild
let browserChild
let cdp
let fixtures

try {
  if (!existsSync(browserPath)) {
    cannotRun(`no browser at ${browserPath} — build it first, or pass --browser`)
  }

  // A static check, stated plainly because it decides whether any of this is
  // reachable in the shipped product: the core executable has no way to be put
  // in session mode.
  const coreMain = readFileSync(join(APP_DIR, 'src', 'core', 'main.ts'), 'utf8')
  const shippedCanSelect = coreMain.includes('agentBrowserMode')
  record(
    'shipped webdeck-core can select session mode (static)',
    shippedCanSelect,
    shippedCanSelect
      ? 'src/core/main.ts passes agentBrowserMode'
      : 'src/core/main.ts never passes agentBrowserMode — the browser-spawned core is always isolated'
  )
  if (!shippedCanSelect) exitCode = 1

  mkdirSync(workDir, { recursive: true })
  fixtures = await startFixtures()
  cleanups.push(() => fixtures.close())

  // Policy: full autonomy, with ONE per-site deny — the strongest rule there is,
  // and the only one that outranks autonomous mode (see src/core/domains/policy.ts).
  // The agent works on 127.0.0.1; "localhost" is the denied destination.
  const userDataDir = join(runtimeDir, 'core-data')
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    join(userDataDir, 'policy.json'),
    JSON.stringify({
      mode: 'autonomous',
      sites: [{ host: 'localhost', decision: 'deny', grantedAt: new Date().toISOString() }],
      blockSensitiveSites: true
    }),
    'utf8'
  )

  const bundle = await buildHarness(workDir)

  const controlToken = `verify-${Math.random().toString(36).slice(2)}${Date.now()}`
  coreChild = spawn(
    process.execPath,
    [bundle, '--user-data', userDataDir, '--port-file', join(runtimeDir, 'core-port.json')],
    {
      cwd: APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WEBDECK_VERIFY_TOKEN: controlToken,
        WEBDECK_VERSION: CORE_MARKER,
        AGWEB_USER_DATA: userDataDir
      }
    }
  )
  cleanups.push(() => {
    if (!flag('keep-open')) coreChild.kill()
  })
  const coreErr = []
  coreChild.stderr.on('data', (d) => coreErr.push(String(d)))

  const ready = await new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(
      () => reject(new Error(`webdeck-core did not start: ${coreErr.join('').slice(-800)}`)),
      timeout
    )
    coreChild.stdout.on('data', (d) => {
      buffered += String(d)
      const line = buffered.split('\n').find((l) => l.includes('"ready"'))
      if (!line) return
      clearTimeout(timer)
      resolve(JSON.parse(line))
    })
    coreChild.on('exit', (code) =>
      reject(new Error(`webdeck-core exited (${code}): ${coreErr.join('').slice(-800)}`))
    )
  })

  const call = async (method, ...args) => {
    const res = await fetch(`http://127.0.0.1:${ready.controlPort}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webdeck-verify': controlToken },
      body: JSON.stringify({ method, args })
    })
    const body = await res.json()
    if (!body.ok) throw new Error(body.error)
    return body.result
  }

  // The port the core actually wired. `recordStart` is implemented on the
  // isolated (CDP) browser and deliberately unimplemented on the session one,
  // so its error message identifies which of the two is in play.
  let wiredPort = 'unknown'
  try {
    await call('recordStart', 'tab-0')
    wiredPort = 'resolved (isolated browser)'
  } catch (err) {
    wiredPort = err.message
  }
  const isSessionPort = wiredPort.includes('not implemented for the session browser')
  if (!isSessionPort) {
    cannotRun(`the core wired the wrong browser port (recordStart said: ${wiredPort})`)
  }

  // Launch the fork.
  browserChild = spawn(
    browserPath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--allow-chrome-scheme-url',
      ...(flag('headless') ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      // Mock the OS keychain. A headless / non-interactive session cannot unlock
      // the login keychain, so the cookie store's OSCrypt "Safe Storage" key
      // fetch blocks forever — stalling every cookie-reading request, including
      // the shell's WebSocket to the core, so chrome://webdeck never boots.
      '--use-mock-keychain',
      `--user-data-dir=${join(runtimeDir, 'browser-profile')}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  cleanups.push(() => {
    if (!flag('keep-open')) browserChild.kill()
  })
  const browserErr = []
  browserChild.stderr.on('data', (d) => browserErr.push(String(d)))

  await waitForDevTools(Date.now() + timeout)

  // A tab of the USER's, opened before the agent does anything, so shutdown can
  // be judged against it.
  await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${fixtures.deniedUrl.replace('/denied-destination', '/idle').replace('localhost', '127.0.0.1')}`,
    {
      method: 'PUT'
    }
  )
  await sleep(500)
  const userTabs = await pageUrls()

  // Open chrome://webdeck in a blank tab we control, pinning OUR core's port and
  // token before the page's own core-port.js runs.
  const created = await (
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })
  ).json()
  cdp = await connect(created.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const coreToken = JSON.parse(readFileSync(join(runtimeDir, 'core-port.json'), 'utf8')).token
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const pin = (name, value) => Object.defineProperty(window, name, {
        get: () => value, set: () => {}, configurable: true
      })
      pin('WEBDECK_CORE_PORT', ${ready.corePort})
      pin('WEBDECK_CORE_TOKEN', ${JSON.stringify(coreToken)})
    })()`
  })
  await cdp.send('Page.navigate', { url: 'chrome://webdeck' })

  await waitFor(
    cdp,
    'document.querySelector(".wd-shell") !== null',
    Date.now() + timeout,
    'the WebDeck shell to mount'
  )
  const version = await waitFor(
    cdp,
    'window.agweb.getAppInfo().then(i => i.version).catch(() => false)',
    Date.now() + timeout,
    'the page to answer app:info'
  )
  if (version !== CORE_MARKER) {
    cannotRun(
      `the page is bound to a different core (version "${version}", expected "${CORE_MARKER}") — ` +
        'the measurement would have been of the browser-spawned isolated core'
    )
  }

  // -- 1. A session-mode core opens a tab in the user's window ---------------
  const workUrl = `http://127.0.0.1:${fixtures.port}/work`
  const before = await pageUrls()
  const opened = await call('openTab', workUrl)
  const tabId = /tabId: (\S+)/.exec(String(opened))?.[1]
  await sleep(500)
  const after = await pageUrls()
  const tabIsReal = Boolean(tabId) && after.includes(workUrl) && after.length === before.length + 1
  record(
    'session core opens a tab in the user’s window',
    tabIsReal,
    tabIsReal
      ? `${tabId} at ${workUrl} (${before.length} → ${after.length} tabs)`
      : `openTab said: ${String(opened).replace(/\n/g, ' | ')}`
  )
  if (!tabIsReal) exitCode = 1
  if (!tabId) throw new Error('openTab returned no tab id — nothing further can be driven')

  // -- 2. Read, click and type through the port's own methods ---------------
  const title = await call('readPage', tabId, '#title')
  await call('type', tabId, '#field', 'hello-session')
  await call('click', tabId, '#go')
  await sleep(300)
  const out = await call('readPage', tabId, '#out')
  const drives =
    String(title).includes('WebDeck session probe') &&
    String(out).trim() === 'clicked:hello-session'
  record(
    'read, click and type drive the real tab',
    drives,
    `#title=${JSON.stringify(String(title).trim())} #out=${JSON.stringify(String(out).trim())}`
  )
  if (!drives) exitCode = 1

  // -- 3. Agent Vision: protocol events must reach the core -----------------
  // Navigate the already-instrumented tab (openTab enables the domains only
  // after the tab exists, so a page opened directly can race its own load).
  const visionUrl = `http://127.0.0.1:${fixtures.port}/vision`
  await call('navigate', tabId, visionUrl)
  await call('waitFor', tabId, '#vision', 10000)
  await sleep(2500) // let the on-timer failure and console error land
  const report = String(await call('visionReport', tabId))
  const hasProblems = await call('visionHasProblems', tabId)
  const namesNetwork = report.includes('boom-load') || report.includes('boom-timer')
  const namesConsole = report.includes(CONSOLE_MARKER)
  const visionOk = namesNetwork && namesConsole && hasProblems === true
  record(
    'Agent Vision names the failed request AND the console error',
    visionOk,
    `visionHasProblems=${hasProblems} | ${report.replace(/\n/g, ' | ')}`
  )
  if (!visionOk) exitCode = 1

  // Informational: a page opened directly, where domain enabling races the load.
  try {
    const direct = await call('openTab', visionUrl)
    const directId = /tabId: (\S+)/.exec(String(direct))?.[1]
    if (directId) {
      await sleep(2500)
      const directReport = String(await call('visionReport', directId))
      notes.push(`direct openTab vision report: ${directReport.replace(/\n/g, ' | ')}`)
    }
  } catch (err) {
    notes.push(`direct openTab vision probe failed: ${err.message}`)
  }

  // -- 4. The navigation guard stops a redirect to a denied site ------------
  const redirectUrl = `http://127.0.0.1:${fixtures.port}/redirect`
  await call('navigate', tabId, redirectUrl)
  await call('waitFor', tabId, '#redirect', 10000)
  let blocked = null
  const guardDeadline = Date.now() + 12000
  while (Date.now() < guardDeadline && blocked === null) {
    await sleep(300)
    blocked = await call('takeBlockedNavigation', tabId)
  }
  let landedOn = ''
  try {
    landedOn = String(await call('evaluate', tabId, 'location.href'))
  } catch (err) {
    landedOn = `could not read: ${err.message}`
  }
  const stopped = !landedOn.includes('/denied-destination')
  const guardOk = blocked === fixtures.deniedUrl && stopped
  record(
    'navigation guard blocks the denied redirect and reports it',
    guardOk,
    `takeBlockedNavigation=${JSON.stringify(blocked)} expected=${JSON.stringify(fixtures.deniedUrl)} location=${landedOn}`
  )
  if (!guardOk) exitCode = 1

  // -- 5. Shutdown closes the agent's tabs, not the user's browser ----------
  const beforeShutdown = await pageUrls()
  await call('shutdown')
  await sleep(1500)
  const alive = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
    .then((r) => r.ok)
    .catch(() => false)
  const remaining = alive ? await pageUrls() : []
  const agentTabsGone =
    !remaining.some((u) => u.startsWith(`http://127.0.0.1:${fixtures.port}/work`)) &&
    !remaining.some((u) => u.startsWith(`http://127.0.0.1:${fixtures.port}/vision`)) &&
    !remaining.some((u) => u.startsWith(`http://127.0.0.1:${fixtures.port}/redirect`))
  const userTabsKept = userTabs.every((u) => remaining.includes(u))
  const browserRunning = alive && browserChild.exitCode === null && browserChild.signalCode === null
  const shutdownOk = browserRunning && agentTabsGone && userTabsKept
  record(
    "shutdown closes the agent's tabs and leaves the browser up",
    shutdownOk,
    `browser=${browserRunning ? 'running' : 'gone'} tabs ${beforeShutdown.length} → ${remaining.length}; user tabs kept=${userTabsKept}; agent tabs gone=${agentTabsGone}`
  )
  if (!shutdownOk) exitCode = 1
} catch (err) {
  cannotRun(err.message)
}

cdp?.close()
cleanup()

if (asJson) {
  console.log(JSON.stringify({ status: exitCode === 0 ? 'pass' : 'fail', checks, notes }, null, 2))
} else {
  for (const c of checks)
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  for (const n of notes) console.log(`· ${n}`)
  console.log(
    exitCode === 0
      ? '\nSession mode works: the agent drives the user’s own tabs.'
      : '\nSession mode is broken — see the ✗ lines above.'
  )
}
process.exit(exitCode)
