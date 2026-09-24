#!/usr/bin/env node
// Proves the built fork still has Chromium's two load-bearing defences turned
// ON: the process sandbox, and full site isolation. Plus the chrome://webdeck
// CSP that keeps a compromised WebUI page from reaching the network or eval'ing.
//
// It also statically guards the Shell privilege boundary — the Mojo interface
// that lets chrome://webdeck drive the window's real tab. That boundary lives in
// source, so it is checked from source with no running browser: the renderer
// bridge (webui/shell.ts) must route only a KNOWN allowlist of browser.*
// channels onto the Shell (never a catch-all, never the core), and the browser
// half (webdeck_shell.cc) must gate every caller-supplied URL through the
// IsAllowedShellUrl scheme allowlist in BOTH Navigate and CreateTab. These run
// even under --static-only, where no browser is launched.
//
// Electron gave us all of this for free. A fork is our own build, so a gn arg,
// a stray command-line switch, or an edit to webdeck_ui.cc can switch any of it
// off with NO visible symptom — the browser looks completely normal, the UI
// mounts, verify-fork.mjs still passes. The only way to know is to measure the
// running browser, which is what this does.
//
// Every claim below is measured against the live process tree or the live page.
// Where a property CANNOT be measured on this platform the line is printed as
// "? not verified: <reason>" and is NOT counted as a pass — a check that
// silently always passes is worse than no check.
//
// Usage:
//   node scripts/verify-hardening.mjs [--browser <path>] [--json] [--headless]
//                                     [--args-gn <path>] [--keep-open] [--timeout <ms>]
//                                     [--static-only]
// Exit codes: 0 pass · 1 hardening is broken · 2 could not run the check
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { builtAppBinary } from './chromium-src.mjs'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DEFAULT_BROWSER = builtAppBinary()
const DEBUG_PORT = 9335

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`verify-hardening — is the fork's sandbox and site isolation actually on?

  --browser <path>     the built binary (default: the BG_Dev component build)
  --args-gn <path>     the build's args.gn (default: found next to the binary)
  --json               machine-readable result
  --keep-open          leave the browser running after the check
  --timeout <ms>       per-step timeout (default 30000)
  --static-only        run ONLY the source-level Shell privilege-boundary checks
                       (no browser launch) and exit on their result
  --release            this build claims to be a shippable release: additionally
                       assert the release gn args (is_official_build = true,
                       is_component_build = false, no fatal DCHECKs) as HARD
                       FAILS rather than notes — a silent revert of these ships a
                       component build with fatal DCHECKs (it has bitten us once)

  --headless           run headless (default: a real window. Headless does not
                       arm the same restrictions, so it is the wrong thing to
                       measure — a windowed-only regression is invisible there)

Exit: 0 pass · 1 hardening broken · 2 could not check`)
  process.exit(0)
}

const browser = arg('browser', DEFAULT_BROWSER)
const timeout = Number(arg('timeout', '30000'))
const asJson = flag('json')
const releaseMode = flag('release')

// The gn args a shippable release MUST resolve to. Their absence is not cosmetic:
// is_official_build = false silently turns dcheck_always_on ON (fatal DCHECKs),
// and is_component_build = true produces a non-distributable 520-dylib tree.
// Documented in chromium/RELEASING.md and chromium/SHIPPABLE.md; enforced under
// --release so a config drift on a release build fails CI instead of shipping.
const REQUIRED_RELEASE_GN_ARGS = {
  is_official_build: 'true',
  is_component_build: 'false',
  dcheck_always_on: 'false',
  is_debug: 'false'
}

/** Fail with exit 2: we could not run the check, which is NOT a pass. */
function cannotRun(message) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason: message }, null, 2))
  else console.error(`cannot run: ${message}`)
  process.exit(2)
}

// --static-only never launches the browser, so a missing binary is fine there.
if (!existsSync(browser) && !flag('static-only')) {
  cannotRun(`no browser at ${browser} — build it first, or pass --browser`)
}

// ── the result ledger ───────────────────────────────────────────────────────
// A check is one of:
//   ok         measured, and the property holds
//   fail       measured, and the property does NOT hold  → exit 1
//   unverified could not be measured. Never a pass. If the property is
//              security-critical this forces exit 2, so an unmeasurable check
//              can never be mistaken for a green one.
//   warn       measured, holds, but the value deserves a human's attention
const checks = []
const ok = (name, detail) => checks.push({ name, status: 'ok', detail })
const fail = (name, detail) => checks.push({ name, status: 'fail', detail })
const warn = (name, detail) => checks.push({ name, status: 'warn', detail })
const unverified = (name, reason, critical = true) =>
  checks.push({ name, status: 'unverified', detail: reason, critical })

// The exit code, raised as checks fail. Declared here — not just before the
// browser launch — so the static checks below can move it and so --static-only
// can report a result without ever starting a browser.
let exitCode = 0

// ── static Shell privilege-boundary checks (no browser needed) ──────────────
// The Shell Mojo interface lets a chrome://webdeck page drive the window's REAL
// tab, so its privilege boundary is load-bearing and it is measurable from
// source alone. A future edit that turns the renderer's SHELL_BROWSER into a
// catch-all, points navigation at the core, or drops the IsAllowedShellUrl
// scheme gate from the browser's Navigate/CreateTab trips one of these.

/**
 * The body of a `WebDeckShell::<name>` method: from its signature to the first
 * line that is exactly `}` — the patch closes every method with a column-0 brace,
 * and the inner (indented) braces never match `\n}`.
 */
function cppMethodBody(source, name) {
  const start = source.indexOf(`WebDeckShell::${name}`)
  if (start === -1) return null
  const end = source.indexOf('\n}', start)
  return end === -1 ? source.slice(start) : source.slice(start, end + 2)
}

function checkShellBoundary() {
  const shellTs = join(repoRoot, 'app/src/webui/shell.ts')
  const adapterTs = join(repoRoot, 'app/src/webui/ipc-adapter.ts')
  const shellCc = join(
    repoRoot,
    'chromium/patches/chrome/browser/ui/webui/webdeck/webdeck_shell.cc'
  )

  // 1. The renderer bridge exposes a KNOWN-channel allowlist, not a catch-all,
  //    and drives navigation over the Shell rather than the core socket.
  if (!existsSync(shellTs)) {
    unverified('shell bridge: SHELL_BROWSER is a known-channel allowlist', `not found: ${shellTs}`)
  } else {
    const src = readFileSync(shellTs, 'utf8')
    const problems = []
    if (!/export\s+const\s+SHELL_BROWSER\b/.test(src)) {
      problems.push('shell.ts no longer exports SHELL_BROWSER')
    }
    // A Proxy or computed default would forward arbitrary channels; the allowlist
    // must stay a static object literal.
    if (/\bnew\s+Proxy\b/.test(src)) {
      problems.push('shell.ts builds a Proxy — a catch-all, not an allowlist')
    }
    // Navigation must reach the browser over the Shell remote, never the core.
    if (/\bclient\.invoke\b/.test(src) || /\bCoreClient\b/.test(src)) {
      problems.push(
        'shell.ts reaches the core (client.invoke/CoreClient) — navigation must go over the Shell'
      )
    }
    if (problems.length === 0) {
      ok(
        'shell bridge: SHELL_BROWSER is a known-channel allowlist, not a catch-all',
        'shell.ts exports a static SHELL_BROWSER literal — no Proxy/default, no core forwarding'
      )
    } else {
      fail(
        'shell bridge: SHELL_BROWSER is a known-channel allowlist, not a catch-all',
        problems.join('; ')
      )
      exitCode = 1
    }

    // Navigation is mapped onto the Shell's navigate() for a Shell tab handle —
    // the active tab (ACTIVE) or, since the multi-tab shell, the handle the
    // shell resolves for the tab id (handleFor(shellId)). Either way the URL
    // reaches the browser's IsAllowedShellUrl gate and nothing else.
    const mapsNav =
      /\[\s*IpcChannels\.browserNavigate\s*\]/.test(src) &&
      /\.navigate\(\s*(ACTIVE\b|handleFor\()/.test(src)
    if (mapsNav) {
      ok(
        'shell bridge: navigation is routed onto the Shell tab',
        'IpcChannels.browserNavigate maps to the Shell remote navigate() on a Shell tab handle'
      )
    } else {
      fail(
        'shell bridge: navigation is routed onto the Shell tab',
        'shell.ts no longer maps IpcChannels.browserNavigate onto the Shell remote navigate(ACTIVE | handleFor(…), …)'
      )
      exitCode = 1
    }
  }

  // 1b. The adapter consults the allowlist as a guarded lookup, so an UNKNOWN
  //     browser.* channel falls through to the core instead of being forwarded to
  //     the Shell — this is what makes SHELL_BROWSER a real allowlist.
  if (existsSync(adapterTs)) {
    const src = readFileSync(adapterTs, 'utf8')
    const guarded =
      /SHELL_BROWSER\s*\[\s*channel\s*\]/.test(src) && /if\s*\(\s*browser\s*\)/.test(src)
    if (guarded) {
      ok(
        'shell bridge: unknown browser.* channels are not forwarded to the Shell',
        'ipc-adapter.ts looks up SHELL_BROWSER[channel] and only calls it when the channel is known'
      )
    } else {
      fail(
        'shell bridge: unknown browser.* channels are not forwarded to the Shell',
        'ipc-adapter.ts no longer guards the SHELL_BROWSER[channel] lookup — an unknown channel may reach the Shell'
      )
      exitCode = 1
    }
  }

  // 2. The browser half gates every caller-supplied URL through IsAllowedShellUrl
  //    in BOTH the tab-creating and the navigating entry points.
  if (!existsSync(shellCc)) {
    unverified(
      'shell host: IsAllowedShellUrl gates both Navigate and CreateTab',
      `not found: ${shellCc}`
    )
  } else {
    const src = readFileSync(shellCc, 'utf8')
    if (!/\bIsAllowedShellUrl\s*\(/.test(src)) {
      fail(
        'shell host: IsAllowedShellUrl gates both Navigate and CreateTab',
        'webdeck_shell.cc has no IsAllowedShellUrl scheme gate at all'
      )
      exitCode = 1
    } else {
      const ungated = ['CreateTab', 'Navigate'].filter((method) => {
        const body = cppMethodBody(src, method)
        return body === null || !/IsAllowedShellUrl\s*\(/.test(body)
      })
      if (ungated.length === 0) {
        ok(
          'shell host: IsAllowedShellUrl gates both Navigate and CreateTab',
          'both WebDeckShell::CreateTab and WebDeckShell::Navigate pass the URL through IsAllowedShellUrl'
        )
      } else {
        fail(
          'shell host: IsAllowedShellUrl gates both Navigate and CreateTab',
          `${ungated.map((m) => `WebDeckShell::${m}`).join(' and ')} do not gate the caller-supplied ` +
            'URL through IsAllowedShellUrl — a compromised chrome://webdeck renderer could drive the ' +
            'window to file://, chrome://, or javascript: over the Shell'
        )
        exitCode = 1
      }
    }
  }
}

checkShellBoundary()

// --static-only stops here: the source invariants above need no running browser.
if (flag('static-only')) finish()

// ── CDP plumbing (same shape as verify-fork.mjs) ────────────────────────────

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

const targetList = async () =>
  await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()

/**
 * Open a URL in a new tab and return its target. Windowed Chromium ignores a
 * chrome:// URL on the command line, so every page this script looks at has to
 * be opened this way.
 */
async function openPage(url, deadline) {
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT'
  })
  while (Date.now() < deadline) {
    const found = (await targetList()).find(
      (t) => t.type === 'page' && String(t.url).startsWith(url.split('#')[0])
    )
    if (found?.webSocketDebuggerUrl) return found
    await sleep(250)
  }
  throw new Error(`${url} never appeared as a target`)
}

/** Minimal CDP client over the page's WebSocket — no dependency on a CDP lib. */
async function connect(wsUrl) {
  const { WebSocket } = await import('ws')
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 })
  const pending = new Map()
  const events = []
  let id = 0

  await new Promise((res, rej) => {
    ws.once('open', res)
    ws.once('error', rej)
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
      return new Promise((res, rej) => {
        pending.set(messageId, { resolve: res, reject: rej })
        ws.send(JSON.stringify({ id: messageId, method, params }))
        setTimeout(() => {
          if (pending.delete(messageId)) rej(new Error(`${method} timed out`))
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

// ── switches that would turn the defences off ───────────────────────────────
// Matched with a token boundary, so --no-sandbox does not match Windows'
// --no-sandbox-and-elevated and vice versa.
const SANDBOX_KILLERS = [
  ['--no-sandbox', 'renderers run with no sandbox at all'],
  ['--disable-setuid-sandbox', 'drops the Linux setuid sandbox'],
  ['--disable-namespace-sandbox', 'drops the Linux namespace sandbox'],
  ['--disable-seccomp-filter-sandbox', 'drops the seccomp-bpf layer'],
  ['--disable-gpu-sandbox', 'the GPU process runs unsandboxed'],
  ['--no-zygote', 'children are forked without the zygote sandbox'],
  ['--single-process', 'everything runs in one process — no sandbox, no isolation'],
  ['--in-process-gpu', 'the GPU runs inside the browser process']
]
const ISOLATION_KILLERS = [
  ['--disable-site-isolation-trials', 'turns site isolation off'],
  ['--disable-site-isolation-for-policy', 'turns site isolation off'],
  ['--disable-web-security', 'turns off the same-origin policy']
]
// Feature names that switch site isolation off through --disable-features.
const ISOLATION_FEATURES = ['SitePerProcess', 'IsolateOrigins', 'SiteIsolation']

const hasSwitch = (command, name) =>
  new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(=|\\s|$)`).test(command)

/** Which processes carry a switch, described once rather than once per process. */
function switchHits(tree, switches) {
  return switches
    .map(([name, why]) => ({ name, why, on: tree.filter((p) => hasSwitch(p.command, name)) }))
    .filter((hit) => hit.on.length > 0)
    .map(
      (hit) =>
        `${hit.name} on ${hit.on.length} process(es) ` +
        `(${[...new Set(hit.on.map((p) => p.type))].join(', ')}) — ${hit.why}`
    )
}

/** Long absolute paths, shortened to their basename so a line stays readable. */
const shortenPaths = (command) =>
  command.replace(/(\S*\/)([^/\s]+)/g, (_, dir, base) =>
    dir.length > 24 ? `…/${base}` : dir + base
  )

/** Every --disable-features value across a command line, flattened. */
function disabledFeatures(command) {
  return [...command.matchAll(/--disable-features=([^\s]+)/g)]
    .flatMap((m) => m[1].split(','))
    .map((f) => f.trim())
    .filter(Boolean)
}

/**
 * Every process of the browser we launched, found by the unique user-data-dir
 * we gave it. Matching on that (rather than on the binary name) is what keeps a
 * stray browser someone else left running from being measured instead of ours.
 */
function processTree(userDataDir) {
  const out = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return out
    .split('\n')
    .filter((line) => line.includes(`--user-data-dir=${userDataDir}`))
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
      if (!m) return null
      const command = m[3]
      const type = command.match(/--type=(\S+)/)?.[1] ?? 'browser'
      const subType = command.match(/--utility-sub-type=(\S+)/)?.[1]
      return {
        pid: Number(m[1]),
        ppid: Number(m[2]),
        command,
        type,
        label: subType ? `${type} (${subType})` : type,
        sandboxed: /--seatbelt-client=\d+/.test(command)
      }
    })
    .filter(Boolean)
}

/**
 * Anything the browser process spawned that is not part of Chromium. These get
 * no sandbox at all: they run with the user's full privileges. webdeck-core is
 * one on purpose, but the point of listing them is that a green sandbox report
 * must never be read as "everything this browser starts is contained".
 */
function foreignChildren(browserPid, frameworkDir) {
  const out = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return out
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m) => m && Number(m[2]) === browserPid && !m[3].startsWith(frameworkDir))
    .map((m) => ({ pid: Number(m[1]), command: m[3] }))
}

// ── gn args ─────────────────────────────────────────────────────────────────
// Build args that mean the binary does not run with a production sandbox.
const UNSAFE_GN_ARGS = {
  is_asan: 'an ASan build; Chromium runs it without the sandbox',
  is_hwasan: 'a HWASan build; runs without the sandbox',
  is_msan: 'an MSan build; runs without the sandbox',
  is_tsan: 'a TSan build; runs without the sandbox',
  is_ubsan: 'a UBSan build; not a shipping configuration',
  is_ubsan_security: 'a UBSan build; not a shipping configuration',
  is_ubsan_vptr: 'a UBSan build; not a shipping configuration',
  use_sanitizer_coverage: 'sanitizer coverage instrumentation is on',
  use_libfuzzer: 'a fuzzer build',
  enable_ipc_fuzzer: 'the IPC fuzzer opens the browser process to the renderer',
  enable_mojom_fuzzer: 'the mojom fuzzer is built in'
}
// Args that are true here and worth a human's eye, with what they cost.
const NOTEWORTHY_GN_ARGS = {
  is_debug: 'a debug build — not what ships',
  dcheck_always_on:
    'DCHECKs are fatal, so conditions a release build tolerates crash the ' +
    'browser (this is what killed it on chrome://webdeck once)',
  is_component_build: 'a developer build split across dylibs — not shippable',
  dcheck_is_configurable: 'DCHECK fatality is feature-controlled at runtime',
  webdeck_dev_keychain:
    'the development keychain is compiled in: on an ad-hoc/unsigned bundle the ' +
    'cookie/password key is a plaintext 0600 file in the profile — dev machines only'
}

/** Parse `name = value` lines from args.gn or from `gn args --list --short`. */
function parseGnArgs(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s*=\s*(.+?)\s*$/i)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2]
  }
  return out
}

/** Find the gn binary that belongs to this checkout, if it is there. */
function findGn(outDir) {
  const src = dirname(dirname(outDir))
  for (const p of ['buildtools/mac/gn', 'buildtools/linux64/gn', 'buildtools/win/gn.exe']) {
    const full = join(src, p)
    if (existsSync(full)) return full
  }
  return null
}

// ── the CSP the repo says this page should have ─────────────────────────────

/** Strip // comments without eating the // inside a "ws://…" string literal. */
function stripLineComments(source) {
  return source
    .split('\n')
    .map((line) => {
      let inString = false
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i - 1] !== '\\') inString = !inString
        else if (!inString && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/**
 * The directive → value pairs webdeck_ui.cc asks for, so the live header can be
 * compared against the source the repo would rebuild from. verify-patches
 * checks repo-vs-checkout; this checks repo-vs-the-binary-we-are-running.
 */
function cspOverridesInSource(file) {
  const source = stripLineComments(readFileSync(file, 'utf8'))
  const out = {}
  for (const call of source.matchAll(/OverrideContentSecurityPolicy\(([\s\S]*?)\);/g)) {
    const body = call[1]
    const name = body.match(/CSPDirectiveName::(\w+)/)?.[1]
    if (!name) continue
    const value = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('')
    if (!value) continue
    const directive = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    out[directive] = value.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim()
  }
  return out
}

/** Split a CSP header into directive → source-list. */
function parseCsp(header) {
  const out = {}
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [name, ...sources] = trimmed.split(/\s+/)
    out[name.toLowerCase()] = sources
  }
  return out
}

// ── run ─────────────────────────────────────────────────────────────────────
const userDataDir = mkdtempSync(join(tmpdir(), 'wd-verify-hardening-'))
const servers = []
let child

/** Two loopback origins that are cross-SITE: 127.0.0.1 and localhost differ. */
function serveOn(host, body) {
  return new Promise((res, rej) => {
    const server = createServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(body)
    })
    server.on('error', rej)
    server.listen(0, host, () => {
      servers.push(server)
      res(server.address().port)
    })
  })
}

function cleanup() {
  for (const s of servers) s.close()
  if (child && !flag('keep-open')) child.kill()
  rmSync(userDataDir, { recursive: true, force: true })
}

try {
  child = spawn(
    browser,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--allow-chrome-scheme-url', // --headless refuses chrome:// without it
      // Headless ONLY when asked, for the same reason verify-fork defaults to a
      // window: headless does not arm every restriction, so measuring it would
      // describe a browser no user runs.
      ...(flag('headless') ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      // Mock the OS keychain. A headless / non-interactive session cannot unlock
      // the login keychain, so the cookie store's OSCrypt "Safe Storage" key
      // fetch blocks forever — stalling browser startup. This check measures
      // process isolation/sandboxing, not cookie encryption, so mocking is safe.
      '--use-mock-keychain',
      `--user-data-dir=${userDataDir}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
} catch (err) {
  cleanup()
  cannotRun(`could not launch the browser: ${err.message}`)
}

const stderr = []
child.stderr.on('data', (d) => stderr.push(String(d)))

let cdp
try {
  const version = await waitForDevTools(Date.now() + timeout)
  const deadline = () => Date.now() + timeout

  // Load the page under test FIRST, and wait for it, so everything below
  // measures a browser that has finished starting: all its renderers spawned,
  // its services up, webdeck-core launched. Measuring a half-started browser
  // reports whichever processes happened to exist at that instant.
  const wdTarget = await openPage('chrome://webdeck', deadline())
  cdp = await connect(wdTarget.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await waitFor(cdp, "document.readyState === 'complete'", deadline(), 'chrome://webdeck to load')

  // ══ 1. the sandbox ════════════════════════════════════════════════════════
  // chrome://sandbox, which the task description suggests, only exists on
  // Linux — on macOS it is ERR_INVALID_URL. The macOS equivalent evidence is
  // on the process tree: a sandboxed child is handed its seatbelt profile over
  // a --seatbelt-client file descriptor, and an unsandboxed one is not.
  let tree = []
  try {
    tree = processTree(userDataDir)
    if (tree.length === 0) {
      unverified(
        'sandbox: the browser process tree',
        'no process carried our --user-data-dir, so nothing could be measured'
      )
    }
  } catch (err) {
    unverified('sandbox: the browser process tree', `could not run ps: ${err.message}`)
  }

  if (tree.length > 0) {
    // 1a. No process in the tree carries a sandbox-disabling switch. This
    //     catches both what we passed and anything the build appends itself.
    const sandboxHits = switchHits(tree, SANDBOX_KILLERS)
    if (sandboxHits.length === 0) {
      ok(
        'sandbox: no sandbox-disabling switch anywhere in the process tree',
        `${SANDBOX_KILLERS.length} switches checked across ${tree.length} processes`
      )
    } else {
      fail(
        'sandbox: no sandbox-disabling switch anywhere in the process tree',
        sandboxHits.join('; ')
      )
      exitCode = 1
    }

    // 1b. Every renderer is actually sandboxed. Asserting the switch is absent
    //     is not the same as asserting the sandbox is on, so measure the sandbox
    //     itself: on macOS, only a sandboxed child gets --seatbelt-client.
    const renderers = tree.filter((p) => p.type === 'renderer')
    if (process.platform !== 'darwin') {
      unverified(
        'sandbox: every renderer process is sandboxed',
        `no evidence source implemented for ${process.platform} — on Linux read ` +
          'chrome://sandbox, which does not exist on macOS'
      )
    } else if (renderers.length === 0) {
      unverified(
        'sandbox: every renderer process is sandboxed',
        'the browser had no renderer process to measure'
      )
    } else {
      const naked = renderers.filter((p) => !p.sandboxed)
      if (naked.length === 0) {
        ok(
          'sandbox: every renderer process is sandboxed',
          `${renderers.length}/${renderers.length} renderers hold a macOS seatbelt handle ` +
            '(chrome://sandbox is Linux-only and was not used)'
        )
      } else {
        fail(
          'sandbox: every renderer process is sandboxed',
          `${naked.length} renderer(s) with no seatbelt handle: ${naked.map((p) => p.pid).join(', ')}`
        )
        exitCode = 1
      }

      // The GPU and the utility services (network, storage) are sandboxed too.
      // Not renderer-grade severity, so this reports rather than fails.
      const helpers = tree.filter((p) => !['renderer', 'browser'].includes(p.type))
      const openHelpers = helpers.filter((p) => !p.sandboxed)
      if (openHelpers.length === 0) {
        ok(
          'sandbox: the GPU and utility processes are sandboxed',
          `${helpers.length} helper(s), all holding a seatbelt handle: ` +
            helpers.map((p) => p.label).join(', ')
        )
      } else {
        warn(
          'sandbox: the GPU and utility processes are sandboxed',
          `no seatbelt handle: ${openHelpers.map((p) => `${p.label} (pid ${p.pid})`).join(', ')}`
        )
      }
    }

    // Chromium's sandbox only covers Chromium's own processes. Anything else
    // the browser spawns runs with the user's full privileges, so name it
    // rather than let a page of ✓ imply the whole tree is contained.
    const browserProc = tree.find((p) => p.type === 'browser')
    if (browserProc) {
      const frameworks = join(dirname(dirname(resolve(browser))), 'Frameworks')
      const foreign = foreignChildren(browserProc.pid, frameworks)
      if (foreign.length === 0) {
        ok(
          'sandbox: the browser spawns no unsandboxed helper of its own',
          'every child process is a Chromium process'
        )
      } else {
        warn(
          'sandbox: the browser spawns no unsandboxed helper of its own',
          'outside the sandbox, with full user privileges: ' +
            foreign.map((p) => `pid ${p.pid} ${shortenPaths(p.command)}`).join('; ') +
            ' — webdeck-core is this by design (chromium/README.md), but it is the ' +
            'one part of the tree the sandbox does not cover'
        )
      }
    }
  }

  // ══ 2. site isolation ═════════════════════════════════════════════════════
  // 2a. The switches that would turn it off are absent.
  if (tree.length > 0) {
    const isolationHits = switchHits(tree, ISOLATION_KILLERS)
    for (const proc of tree) {
      for (const feature of disabledFeatures(proc.command)) {
        if (ISOLATION_FEATURES.some((f) => feature.toLowerCase() === f.toLowerCase())) {
          isolationHits.push(`${proc.type} pid ${proc.pid}: --disable-features=${feature}`)
        }
      }
    }
    if (isolationHits.length === 0) {
      ok(
        'site isolation: no isolation-disabling switch or feature',
        `${ISOLATION_KILLERS.length} switches and ${ISOLATION_FEATURES.length} feature names checked`
      )
    } else {
      fail('site isolation: no isolation-disabling switch or feature', isolationHits.join('; '))
      exitCode = 1
    }
  }

  // 2b. The browser reports full site isolation, not a partial mode.
  try {
    const target = await openPage('chrome://process-internals/#site-isolation', deadline())
    const internals = await connect(target.webSocketDebuggerUrl)
    await internals.send('Runtime.enable')
    const text = await waitFor(
      internals,
      "document.body.innerText.includes('Site Isolation mode:') && document.body.innerText",
      deadline(),
      'chrome://process-internals to report the site isolation mode'
    )
    internals.close()
    const mode = String(text)
      .match(/Site Isolation mode:\s*(.+)/)?.[1]
      ?.trim()
    if (mode === 'Site Per Process') {
      ok('site isolation: the mode is full (Site Per Process)', 'chrome://process-internals')
    } else {
      fail(
        'site isolation: the mode is full (Site Per Process)',
        `chrome://process-internals reports "${mode ?? '(not found)'}" — not full site isolation`
      )
      exitCode = 1
    }
  } catch (err) {
    unverified('site isolation: the mode is full (Site Per Process)', err.message)
  }

  // 2c. The mode string is what the browser believes; this is what it does.
  //     http://localhost and http://127.0.0.1 are different SITES, so with full
  //     site isolation the iframe must be out-of-process — and an out-of-process
  //     iframe is the only kind that gets its own DevTools target.
  try {
    const innerPort = await serveOn('127.0.0.1', '<title>inner</title><h1>inner</h1>')
    const inner = `http://127.0.0.1:${innerPort}/`
    const outerPort = await serveOn(
      'localhost',
      `<title>outer</title><h1>outer</h1><iframe src="${inner}"></iframe>`
    )
    const outer = `http://localhost:${outerPort}/`

    const before = new Set(processTree(userDataDir).map((p) => p.pid))
    const target = await openPage(outer, deadline())
    const page = await connect(target.webSocketDebuggerUrl)
    await page.send('Runtime.enable')
    await waitFor(
      page,
      "document.querySelector('iframe') !== null",
      deadline(),
      'the cross-site iframe to be attached'
    )
    page.close()

    let oopif = null
    const by = deadline()
    while (!oopif && Date.now() < by) {
      oopif = (await targetList()).find((t) => t.type === 'iframe' && t.url === inner)
      if (!oopif) await sleep(250)
    }
    const added = processTree(userDataDir).filter(
      (p) => p.type === 'renderer' && !before.has(p.pid)
    )
    if (oopif) {
      ok(
        'site isolation: a cross-site iframe lands in its own renderer',
        `${outer} framing ${inner} produced an out-of-process iframe; ` +
          `${added.length} new renderer process(es)`
      )
    } else {
      fail(
        'site isolation: a cross-site iframe lands in its own renderer',
        `${inner} inside ${outer} stayed in the parent's process — cross-site content ` +
          'is sharing a renderer with its embedder'
      )
      exitCode = 1
    }
  } catch (err) {
    unverified('site isolation: a cross-site iframe lands in its own renderer', err.message)
  }

  // ══ 3. the build's gn args ════════════════════════════════════════════════
  // args.gn holds only what was set explicitly. Everything else is a default
  // resolved by the build graph, so reading args.gn alone would report
  // "dcheck_always_on: not set" for a build where it is very much on. Ask gn
  // for the resolved values, and say so plainly when we could not.
  // Read once here, used again by the signature check below.
  let gnEffective = null
  let outDir = arg('args-gn') ? dirname(resolve(arg('args-gn'))) : null
  if (!outDir) {
    let dir = dirname(resolve(browser))
    while (dir !== dirname(dir) && !existsSync(join(dir, 'args.gn'))) dir = dirname(dir)
    outDir = existsSync(join(dir, 'args.gn')) ? dir : null
  }

  if (!outDir) {
    unverified(
      'gn args: nothing in the build disables the sandbox',
      `no args.gn found near ${browser}`
    )
  } else {
    const explicit = parseGnArgs(readFileSync(join(outDir, 'args.gn'), 'utf8'))
    const gn = findGn(outDir)
    let resolved = null
    if (gn) {
      try {
        resolved = parseGnArgs(
          execFileSync(gn, ['args', outDir, '--list', '--short'], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            cwd: dirname(dirname(outDir))
          })
        )
      } catch (err) {
        resolved = null
        unverified(
          'gn args: resolved build defaults',
          `gn could not list them: ${String(err.message).split('\n')[0]}`,
          false
        )
      }
    } else {
      unverified(
        'gn args: resolved build defaults',
        'no gn binary in the checkout, so only the explicit args.gn overrides were ' +
          'read — defaulted args such as dcheck_always_on are unknown',
        false
      )
    }

    const effective = resolved ?? explicit
    gnEffective = effective
    const source = resolved ? 'resolved by gn' : 'args.gn overrides only'
    const unsafe = Object.entries(UNSAFE_GN_ARGS).filter(([k]) => effective[k] === 'true')
    if (unsafe.length === 0) {
      ok(
        'gn args: nothing in the build disables the sandbox',
        `${Object.keys(UNSAFE_GN_ARGS).length} args checked (${source}) in ${join(outDir, 'args.gn')}`
      )
    } else {
      fail(
        'gn args: nothing in the build disables the sandbox',
        unsafe.map(([k, why]) => `${k} = true — ${why}`).join('; ')
      )
      exitCode = 1
    }

    // A line mentioning the sandbox in args.gn is always a human's decision.
    const sandboxLines = Object.keys(explicit).filter((k) => /sandbox/i.test(k))
    if (sandboxLines.length > 0) {
      warn(
        'gn args: args.gn does not mention the sandbox',
        `set explicitly: ${sandboxLines.map((k) => `${k} = ${explicit[k]}`).join(', ')}`
      )
    } else {
      ok('gn args: args.gn does not mention the sandbox', 'no sandbox arg is overridden')
    }

    for (const [name, cost] of Object.entries(NOTEWORTHY_GN_ARGS)) {
      if (effective[name] === 'true') warn(`gn args: ${name} = true`, `${cost} (${source})`)
    }

    // Under --release, the shippable gn args stop being notes and become
    // invariants: a release build that resolved is_official_build = false (→
    // fatal DCHECKs) or is_component_build = true (→ non-distributable) is a
    // FAIL, not a warning. Needs gn's resolved values — args.gn overrides alone
    // cannot confirm a default-valued arg, so say so rather than pass blindly.
    if (releaseMode) {
      if (!resolved) {
        unverified(
          'gn args: release build config is shippable',
          'no gn binary in the checkout, so resolved args could not be read — a ' +
            'release claim cannot be confirmed from args.gn overrides alone',
          true
        )
      } else {
        const drift = Object.entries(REQUIRED_RELEASE_GN_ARGS).filter(
          ([k, want]) => (resolved[k] ?? '(unset)') !== want
        )
        if (drift.length === 0) {
          ok(
            'gn args: release build config is shippable',
            `is_official_build=true, is_component_build=false, dcheck_always_on=false, is_debug=false (${source})`
          )
        } else {
          fail(
            'gn args: release build config is shippable',
            drift.map(([k, want]) => `${k} = ${resolved[k] ?? '(unset)'}, want ${want}`).join('; ')
          )
          exitCode = 1
        }
      }
    }
  }

  // ══ 3b. the code signature ════════════════════════════════════════════════
  // A Team Identifier is what a Developer ID signature carries and an ad-hoc or
  // unsigned bundle does not. Two things follow from its absence: Gatekeeper
  // refuses the app on a machine that did not build it, and — only in a build
  // compiled with webdeck_dev_keychain — the OSCrypt password becomes a 0600
  // file in the profile ("WebDeck Dev Keychain") instead of a login-Keychain
  // item (components/os_crypt/webdeck/dev_keychain.h). The two are reported
  // separately, because saying "the development keychain is active" about a
  // build that compiled it out is simply false.
  if (releaseMode) {
    const bundle = resolve(browser, '..', '..', '..')
    try {
      const sig = execFileSync('sh', ['-c', 'codesign -dv "$1" 2>&1', '_', bundle], {
        encoding: 'utf8'
      })
      const team = /TeamIdentifier=(.+)/.exec(sig)?.[1]?.trim()
      // gnArgs is read earlier for the release-config check; when it could not
      // be read at all, the honest answer is that the keychain path is unknown.
      const devKeychain = gnEffective?.webdeck_dev_keychain
      if (team && team !== 'not set') {
        ok('signature: Team Identifier present, the real Keychain is in use', team)
      } else if (devKeychain === 'true') {
        warn(
          'signature: no Team Identifier, and the development keychain is compiled in',
          'the cookie/password key is a plaintext 0600 file in the profile, and Gatekeeper will refuse this bundle. Rebuild with webdeck_dev_keychain = false and sign with a Developer ID before shipping.'
        )
      } else {
        warn(
          'signature: no Team Identifier',
          `Gatekeeper will refuse this bundle on any machine that did not build it${devKeychain === 'false' ? '. The development keychain is compiled out, so the real Keychain is used' : ''}. Sign with a Developer ID and notarize: npm run release:preflight.`
        )
      }
    } catch (error) {
      unverified('signature: Team Identifier', `codesign failed: ${error.message}`, false)
    }
  }

  // ══ 4. the chrome://webdeck CSP ═══════════════════════════════════════════
  // The CSP arrives as a response header, so it can only be read by watching the
  // document load. chrome://webdeck is already open, so turn Network on and
  // reload it.
  await cdp.send('Network.enable')
  await cdp.send('Page.reload')

  let header = null
  const headerBy = deadline()
  while (!header && Date.now() < headerBy) {
    const doc = cdp.events.find(
      (e) =>
        e.method === 'Network.responseReceived' &&
        e.params?.type === 'Document' &&
        String(e.params?.response?.url).startsWith('chrome://webdeck')
    )
    const headers = doc?.params?.response?.headers ?? {}
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy')
    if (key) header = headers[key]
    else await sleep(250)
  }

  if (!header) {
    unverified(
      'CSP: connect-src is not a wildcard',
      'no Content-Security-Policy header was seen on the chrome://webdeck document'
    )
    unverified('CSP: no unsafe-eval', 'no Content-Security-Policy header to read')
  } else {
    const csp = parseCsp(header)
    const connect = csp['connect-src']
    if (!connect) {
      fail(
        'CSP: connect-src is not a wildcard',
        `connect-src is absent — default-src applies: ${header}`
      )
      exitCode = 1
    } else if (connect.includes('*') || connect.includes('http:') || connect.includes('https:')) {
      fail(
        'CSP: connect-src is not a wildcard',
        `connect-src ${connect.join(' ')} — the page can reach anything`
      )
      exitCode = 1
    } else {
      ok('CSP: connect-src is not a wildcard', `connect-src ${connect.join(' ')}`)
    }

    const scriptSources = [
      ...(csp['script-src'] ?? []),
      ...(csp['script-src-elem'] ?? []),
      ...(csp['default-src'] ?? [])
    ]
    if (scriptSources.includes("'unsafe-eval'")) {
      fail('CSP: no unsafe-eval', `script sources include 'unsafe-eval': ${header}`)
      exitCode = 1
    } else {
      ok('CSP: no unsafe-eval', `script-src ${(csp['script-src'] ?? []).join(' ')}`)
    }
    if ((csp['script-src'] ?? []).includes("'unsafe-inline'")) {
      warn('CSP: script-src allows unsafe-inline', `script-src ${csp['script-src'].join(' ')}`)
    }

    // The header is what this binary serves. Compare it against the source the
    // repo would rebuild from, so a CSP that exists only in one of them shows up.
    const uiSource = join(
      repoRoot,
      'chromium/patches/chrome/browser/ui/webui/webdeck/webdeck_ui.cc'
    )
    if (!existsSync(uiSource)) {
      unverified('CSP: the live header matches webdeck_ui.cc', `not found: ${uiSource}`, false)
    } else {
      const wanted = cspOverridesInSource(uiSource)
      const names = Object.keys(wanted)
      if (names.length === 0) {
        unverified(
          'CSP: the live header matches webdeck_ui.cc',
          'no OverrideContentSecurityPolicy call could be parsed out of the source',
          false
        )
      } else {
        const drifted = names.filter(
          (name) => `${name} ${(csp[name] ?? []).join(' ')}`.trim() !== wanted[name]
        )
        if (drifted.length === 0) {
          ok(
            'CSP: the live header matches webdeck_ui.cc',
            `${names.length} directive(s) the repo overrides are served verbatim`
          )
        } else {
          fail(
            'CSP: the live header matches webdeck_ui.cc',
            drifted
              .map(
                (n) =>
                  `${n}: repo wants "${wanted[n]}", browser serves "${n} ${(csp[n] ?? []).join(' ')}"`
              )
              .join('; ')
          )
          exitCode = 1
        }
      }
    }
  }

  // A header is a claim. This is the enforcement.
  //
  // It cannot be measured with a plain Runtime.evaluate: DevTools evaluations
  // are exempt from the page's CSP, so `eval('1+1')` returns 2 on this page even
  // though eval is blocked — exactly the silent always-passes check this script
  // exists to avoid. So run the eval inside a same-origin blob worker, which
  // inherits the document's CSP and gets no such exemption. Both the worker URL
  // and the inline script need a Trusted Types policy first; the page's CSP
  // allows any policy NAME (trusted-types *) while still requiring one.
  await waitFor(
    cdp,
    "document.readyState === 'complete'",
    deadline(),
    'chrome://webdeck to finish reloading'
  )
  const enforcement = `(async () => {
    const out = {}
    let policy = null
    try {
      policy = window.trustedTypes
        ? window.trustedTypes.createPolicy('wd-verify-hardening', {
            createScript: (s) => s,
            createScriptURL: (s) => s
          })
        : null
    } catch (e) {
      out.policy = 'could not create a trusted-types policy: ' + e.message
    }
    out.eval = await new Promise((done) => {
      try {
        const src =
          "try { eval('1+1'); postMessage('RAN') } catch (e) { postMessage('BLOCKED: ' + e.name) }"
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        const worker = new Worker(policy ? policy.createScriptURL(url) : url)
        const timer = setTimeout(() => done('INCONCLUSIVE: the worker never answered'), 8000)
        worker.onmessage = (e) => { clearTimeout(timer); done(e.data); worker.terminate() }
        worker.onerror = (e) => {
          clearTimeout(timer)
          done('INCONCLUSIVE: worker error: ' + (e.message || 'no message'))
        }
      } catch (e) {
        done('INCONCLUSIVE: could not create the worker: ' + e.message)
      }
    })
    out.inline = await new Promise((done) => {
      const timer = setTimeout(() => done('INCONCLUSIVE: no violation and no execution'), 4000)
      document.addEventListener(
        'securitypolicyviolation',
        (e) => {
          if (String(e.violatedDirective).startsWith('script-src')) {
            clearTimeout(timer)
            done('BLOCKED: ' + e.violatedDirective)
          }
        },
        { once: true }
      )
      try {
        const el = document.createElement('script')
        el.textContent = policy
          ? policy.createScript('window.__wdInlineRan = true')
          : 'window.__wdInlineRan = true'
        document.head.appendChild(el)
        if (window.__wdInlineRan) { clearTimeout(timer); done('RAN') }
      } catch (e) {
        clearTimeout(timer)
        done('INCONCLUSIVE: ' + e.name + ': ' + e.message)
      }
    })
    return JSON.stringify(out)
  })()`
  const enforced = JSON.parse(await evaluate(cdp, enforcement))

  if (String(enforced.eval).startsWith('BLOCKED')) {
    ok('CSP: eval really is refused at runtime', `${enforced.eval} inside a same-origin worker`)
  } else if (String(enforced.eval).startsWith('INCONCLUSIVE')) {
    unverified('CSP: eval really is refused at runtime', enforced.eval)
  } else {
    fail(
      'CSP: eval really is refused at runtime',
      `eval ran on chrome://webdeck (${enforced.eval})`
    )
    exitCode = 1
  }

  if (String(enforced.inline).startsWith('BLOCKED')) {
    ok('CSP: an injected inline script really is refused', enforced.inline)
  } else if (String(enforced.inline).startsWith('INCONCLUSIVE')) {
    unverified('CSP: an injected inline script really is refused', enforced.inline)
  } else {
    fail(
      'CSP: an injected inline script really is refused',
      `an inline <script> executed on chrome://webdeck (${enforced.inline})`
    )
    exitCode = 1
  }

  // Everything above can pass against a process that is already dying.
  if (child.exitCode !== null || child.signalCode !== null) {
    fail('the browser survived the whole check', `exited ${child.exitCode ?? child.signalCode}`)
    exitCode = 1
  } else {
    ok('the browser survived the whole check', version['User-Agent'])
  }
} catch (err) {
  cdp?.close()
  cleanup()
  if (asJson) {
    console.log(JSON.stringify({ status: 'error', reason: err.message, checks }, null, 2))
  } else {
    console.error(`cannot run: ${err.message}`)
    if (stderr.length) console.error(stderr.join('').split('\n').slice(-10).join('\n'))
  }
  process.exit(2)
}

cdp?.close()
cleanup()
finish()

// Print the ledger and exit. A function (hoisted) so --static-only can report
// the source-level checks above without ever launching a browser.
function finish() {
  // An unmeasurable security property is not a pass. If it is one of the ones
  // this script exists to assert, that is exit 2 — "could not check" — never 0.
  const failed = checks.filter((c) => c.status === 'fail')
  const blind = checks.filter((c) => c.status === 'unverified' && c.critical !== false)
  const warned = checks.filter((c) => c.status === 'warn')
  if (failed.length > 0) exitCode = 1
  else if (blind.length > 0) exitCode = 2

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          status: exitCode === 0 ? 'pass' : exitCode === 1 ? 'fail' : 'incomplete',
          browser,
          headless: flag('headless'),
          platform: process.platform,
          summary: {
            passed: checks.filter((c) => c.status === 'ok').length,
            failed: failed.length,
            warnings: warned.length,
            notVerified: checks.filter((c) => c.status === 'unverified').length
          },
          checks
        },
        null,
        2
      )
    )
  } else {
    const mark = { ok: '✓', fail: '✗', warn: '!', unverified: '?' }
    console.log(
      `Arcwel WebDeck — sandbox, site isolation and CSP (${process.platform}${flag('headless') ? ', headless' : ', windowed'})\n`
    )
    for (const c of checks) {
      const label = c.status === 'unverified' ? `${c.name} — not verified` : c.name
      console.log(`${mark[c.status]} ${label}${c.detail ? `\n      ${c.detail}` : ''}`)
    }
    if (exitCode === 0) {
      console.log(
        `\nThe fork is hardened.${warned.length ? ` ${warned.length} warning(s) above.` : ''}`
      )
    } else if (exitCode === 1) {
      console.log(`\n${failed.length} security property/properties are BROKEN — see the ✗ lines.`)
    } else {
      console.log(
        `\n${blind.length} security property/properties could NOT be measured — see the ? lines. ` +
          'This is not a pass.'
      )
    }
  }
  process.exit(exitCode)
}
