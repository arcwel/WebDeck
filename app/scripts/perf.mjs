#!/usr/bin/env node
// Performance pass (TASKS.md 10.4): startup time and memory, with multiple
// browser tabs and agents — measured on the real built fork, repeatably.
//
// What it measures
//   startup   spawn → CDP answers → chrome://webdeck target exists → the
//             webdeck-core child appears (the shell's backend is up)
//   memory    physical footprint (macOS; RSS elsewhere) of the WHOLE process
//             tree — browser, every renderer, gpu, network/utility services and
//             webdeck-core — after the shell settles, then again after each of
//             N tabs is opened, so the per-tab cost is a measured delta of the
//             tab's own renderer, not a guess
//   agents    (opt-in, --agents M) start M mock agent sessions on the core over
//             its WebSocket and report the core's RSS delta
//   core      the standalone webdeck-core executable booted on its own:
//             ready-latency and RSS, independent of the browser
//
// Why the process tree and not one PID: Chromium is many processes, and a
// per-tab renderer is where tab memory actually lives. Summing one PID would
// hide exactly the number 10.4 asks for.
//
// Thresholds (--max-*) turn this into a regression gate: exceeding one exits 1,
// so CI can fail a change that makes startup slower or a tab heavier. Without
// thresholds it is a report. Exit 2 = could not measure, which is NOT a pass.
//
// Usage: node scripts/perf.mjs [--browser <path>] [--tabs N] [--agents M]
//        [--settle-ms N] [--max-startup-ms N] [--max-rss-mb N] [--max-tab-mb N]
//        [--json] [--keep-open] [--help]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export const EXIT_OK = 0
export const EXIT_THRESHOLD = 1
export const EXIT_ERROR = 2

const DEFAULT_BROWSER =
  '/Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck-release-package/stage/' +
  'Arcwel WebDeck.app/Contents/MacOS/Arcwel WebDeck'
const DEBUG_PORT = 9337
const CORE_EXE = join(appRoot, 'out', 'core', 'webdeck-core')

const HELP = `perf — startup time and memory of the built fork, with tabs and agents (TASKS.md 10.4)

Usage
  npm run perf -- [options]

Options
  --browser <path>      the built browser binary (default: the signed release stage)
  --tabs <N>            tabs to open after the shell settles (default 5)
  --agents <M>          mock agent sessions to start on the core (default 0 = skip)
  --settle-ms <N>       wait after the shell appears before measuring (default 3000)
  --max-startup-ms <N>  fail (exit 1) if spawn→shell exceeds this
  --max-rss-mb <N>      fail (exit 1) if the settled process-tree memory exceeds this
                        (physical footprint on macOS, RSS elsewhere)
  --max-tab-mb <N>      fail (exit 1) if the per-tab renderer memory exceeds this
  --rss                 report RSS instead of physical footprint (also the fallback
                        when footprint hangs, as it does where process inspection is blocked)
  --json                machine-readable result on stdout
  --keep-open           leave the browser running afterwards
  --help, -h            this text

Exit: 0 measured (and within any thresholds) · 1 a threshold was exceeded · 2 could not measure`

const args = process.argv.slice(2)
function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Number(process.hrtime.bigint() / 1_000_000n)

// ── the process tree, with memory ───────────────────────────────────────────
/** Every process on the box: pid, ppid, RSS in MB, command. */
function allProcesses() {
  const out = execFileSync('ps', ['-ax', '-o', 'pid=,ppid=,rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  return out
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((m) => ({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssMb: Number(m[3]) / 1024, // ps reports KB on macOS and Linux
      command: m[4]
    }))
}

/**
 * The browser's whole tree rooted at `rootPid`: the browser process plus every
 * descendant (renderers, gpu, network, utilities, and webdeck-core — which is
 * spawned without --user-data-dir, so matching on that flag alone misses it).
 */
export function processTree(rootPid, procs = allProcesses()) {
  const byParent = new Map()
  for (const p of procs) {
    if (!byParent.has(p.ppid)) byParent.set(p.ppid, [])
    byParent.get(p.ppid).push(p)
  }
  const tree = []
  const queue = [rootPid]
  while (queue.length) {
    const pid = queue.shift()
    const self = procs.find((p) => p.pid === pid)
    if (self) tree.push(self)
    for (const child of byParent.get(pid) ?? []) queue.push(child.pid)
  }
  return tree.map((p) => ({ ...p, type: classify(p.command) }))
}

function classify(command) {
  if (/webdeck-core/.test(command)) return 'webdeck-core'
  const type = command.match(/--type=(\S+)/)?.[1]
  if (!type) return 'browser'
  const sub = command.match(/--utility-sub-type=([\w.]+)/)?.[1]
  return sub ? `${type}:${sub.replace(/\.mojom\.\w+$/, '')}` : type
}

/**
 * Physical footprint of one process (macOS `footprint`), in MB, or null.
 *
 * RSS is the wrong headline for Chromium: the ~100 MB framework is mapped into
 * EVERY renderer and ps counts those shared resident pages once per process, so
 * RSS says a blank tab costs ~120 MB when its unique memory is ~30 MB. The
 * physical footprint is what the OS actually charges the process — the number
 * that matters for "memory with multiple tabs". Falls back to RSS elsewhere.
 */
// `footprint` needs the same process-inspection right a debugger does. On a
// machine where that is blocked it does not fail, it hangs — so each call is
// bounded, and after the first one that does not answer the run falls back to
// RSS for every process and says so, rather than sitting forever.
const FOOTPRINT_TIMEOUT_MS = 3000
let footprintUnavailable = process.platform !== 'darwin' || args.includes('--rss')

function physFootprintMb(pid) {
  if (footprintUnavailable) return null
  try {
    const out = execFileSync('footprint', ['-p', String(pid)], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: FOOTPRINT_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    })
    const m = out.match(/phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/i)
    if (!m) return null
    const n = Number(m[1])
    return m[2].toUpperCase() === 'GB' ? n * 1024 : m[2].toUpperCase() === 'KB' ? n / 1024 : n
  } catch (error) {
    if (error && (error.killed || error.signal === 'SIGKILL')) {
      footprintUnavailable = true
      process.stderr.write(
        `perf: footprint did not answer in ${FOOTPRINT_TIMEOUT_MS} ms (process inspection is blocked on this machine); reporting RSS instead, which double-counts shared pages\n`
      )
    }
    return null
  }
}

/** Whether the memory numbers are physical footprint (true) or RSS (false). */
export function memoryIsFootprint() {
  return !footprintUnavailable
}

/** Attach the footprint to a tree; `memMb` is the headline (footprint, else RSS). */
function enrich(tree) {
  return tree.map((p) => {
    const footprintMb = physFootprintMb(p.pid)
    return { ...p, footprintMb, memMb: footprintMb ?? p.rssMb }
  })
}

/** Sum memory (footprint when known, else RSS), with a breakdown by type. */
export function summarize(tree) {
  const byType = {}
  let total = 0
  let rss = 0
  for (const p of tree) {
    const mb = p.memMb ?? p.rssMb
    byType[p.type] = (byType[p.type] ?? 0) + mb
    total += mb
    rss += p.rssMb
  }
  const round = (n) => Math.round(n * 10) / 10
  return {
    totalMb: round(total),
    rssMb: round(rss),
    metric: tree.some((p) => p.footprintMb != null) ? 'footprint' : 'rss',
    processes: tree.length,
    byType: Object.fromEntries(
      Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, round(v)])
    )
  }
}

// ── CDP over http (no per-target socket needed) ─────────────────────────────
async function cdpJson(path) {
  const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}${path}`, {
    method: path.startsWith('/json/new') ? 'PUT' : 'GET'
  })
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r.json()
}
async function waitFor(pred, timeoutMs, label) {
  const by = Date.now() + timeoutMs
  while (Date.now() < by) {
    try {
      const v = await pred()
      if (v) return v
    } catch {
      /* not yet */
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** A tiny local page so tab cost is measured, not the network. */
function serveLocalPage() {
  return new Promise((res, rej) => {
    const server = createServer((_req, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>perf tab</title><h1>perf tab</h1>')
    })
    server.on('error', rej)
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }))
  })
}

// ── measurements ────────────────────────────────────────────────────────────
async function measureBrowser({ browser, tabs, agents, settleMs, keepOpen }) {
  const profile = mkdtempSync(join(tmpdir(), 'wd-perf-'))
  const result = { startup: {}, memory: {}, tabs: [], agents: null }
  let child
  let page
  try {
    const t0 = now()
    child = spawn(
      browser,
      [
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--no-first-run',
        '--no-default-browser-check',
        // Headless/automated sessions cannot unlock the login keychain; without
        // this the cookie store's key fetch blocks and the shell never boots.
        '--use-mock-keychain',
        `--user-data-dir=${profile}`
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
        // Inherited by the spawned webdeck-core so --agents can use the
        // deterministic scripted provider instead of a real API key.
        env: { ...process.env, ...(agents > 0 ? { AGWEB_AGENT_MOCK: '1' } : {}) }
      }
    )

    await waitFor(() => cdpJson('/json/version'), 30000, 'CDP to answer')
    result.startup.cdpMs = now() - t0

    await waitFor(
      async () =>
        (await cdpJson('/json/list')).find(
          (t) => t.type === 'page' && String(t.url).startsWith('chrome://webdeck')
        ),
      30000,
      'the chrome://webdeck target'
    )
    result.startup.shellMs = now() - t0

    await waitFor(
      () => processTree(child.pid).find((p) => p.type === 'webdeck-core'),
      30000,
      'webdeck-core to be spawned'
    )
    result.startup.coreMs = now() - t0

    await sleep(settleMs)
    result.memory.settled = summarize(enrich(processTree(child.pid)))
    result.memory.basis = memoryIsFootprint() ? 'footprint' : 'rss'

    // Tabs: each is a fresh renderer, so the delta is the honest per-tab cost.
    if (tabs > 0) {
      page = await serveLocalPage()
      const round = (n) => Math.round(n * 10) / 10
      let prev = result.memory.settled
      for (let i = 1; i <= tabs; i++) {
        await cdpJson(`/json/new?http://127.0.0.1:${page.port}/`)
        await sleep(800)
        const s = summarize(enrich(processTree(child.pid)))
        // Per-type delta: says WHERE a tab's memory went — a new renderer is the
        // page itself (Chromium's baseline), but growth in the shell renderer or
        // the browser process per tab would be our own per-tab state leaking.
        const byTypeDelta = {}
        for (const k of new Set([...Object.keys(s.byType), ...Object.keys(prev.byType)])) {
          const d = round((s.byType[k] ?? 0) - (prev.byType[k] ?? 0))
          if (d !== 0) byTypeDelta[k] = d
        }
        result.tabs.push({
          tab: i,
          totalMb: s.totalMb,
          deltaMb: round(s.totalMb - prev.totalMb),
          byTypeDelta
        })
        prev = s
      }
      const avg = (xs) => round(xs.reduce((a, b) => a + b, 0) / xs.length)
      const types = new Set(result.tabs.flatMap((t) => Object.keys(t.byTypeDelta)))
      result.memory.perTabByType = Object.fromEntries(
        [...types]
          .map((k) => [k, avg(result.tabs.map((t) => t.byTypeDelta[k] ?? 0))])
          .sort((a, b) => b[1] - a[1])
      )
      // The headline per-tab cost is the tab's OWN process — a fresh renderer.
      // The whole-tree delta is kept for reference but is noisy: the GPU process
      // sheds and reclaims compositing memory as surfaces come and go, which is
      // not a per-tab cost and swings a tree average by tens of MB either way.
      result.memory.perTabMb =
        result.memory.perTabByType.renderer ?? avg(result.tabs.map((t) => t.deltaMb))
      result.memory.perTabTreeMb = avg(result.tabs.map((t) => t.deltaMb))
      result.memory.withTabsMb = prev.totalMb
    }

    // Agents (opt-in): connect to the core with its per-boot token and start M
    // scripted sessions, then read the core's RSS delta.
    if (agents > 0) result.agents = await measureAgents(child.pid, agents)

    return result
  } finally {
    page?.server.close()
    if (!keepOpen && child) {
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
      for (const p of processTree(child.pid)) {
        try {
          process.kill(p.pid, 'SIGKILL')
        } catch {
          /* gone */
        }
      }
      rmSync(profile, { recursive: true, force: true })
    }
  }
}

async function measureAgents(browserPid, count) {
  const core = processTree(browserPid).find((p) => p.type === 'webdeck-core')
  const portFile = core?.command.match(/--port-file=(\S+)/)?.[1]
  if (!portFile || !existsSync(portFile)) {
    return { skipped: 'could not find the core port-file to connect' }
  }
  const { port, token } = JSON.parse(readFileSync(portFile, 'utf8'))
  const before = processTree(browserPid).find((p) => p.type === 'webdeck-core')?.rssMb ?? 0
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, [`webdeck.token.v1.${token}`])
  let id = 0
  const pending = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    const w = pending.get(m.id)
    if (!w) return
    pending.delete(m.id)
    if (m.error) w.reject(new Error(m.error))
    else w.resolve(m.result)
  })
  const call = (method, args = []) =>
    new Promise((resolve, reject) => {
      const i = ++id
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, args }))
      setTimeout(() => reject(new Error(`timeout: ${method}`)), 8000)
    })
  try {
    await new Promise((r, j) => {
      ws.on('open', r)
      ws.on('error', j)
    })
    let started = 0
    for (let i = 0; i < count; i++) {
      try {
        await call('agent:start', [`perf agent ${i + 1}: summarize the current page`])
        started++
      } catch (err) {
        return { started, skipped: `agent:start failed: ${err.message}` }
      }
    }
    await sleep(1500)
    const after = processTree(browserPid).find((p) => p.type === 'webdeck-core')?.rssMb ?? 0
    const round = (n) => Math.round(n * 10) / 10
    return {
      started,
      coreBeforeMb: round(before),
      coreAfterMb: round(after),
      coreDeltaMb: round(after - before),
      perAgentMb: started ? round((after - before) / started) : null
    }
  } finally {
    ws.close()
  }
}

async function measureCore() {
  if (!existsSync(CORE_EXE)) return { skipped: `no core at ${CORE_EXE} — run build:core` }
  const dataDir = mkdtempSync(join(tmpdir(), 'wd-perf-core-'))
  const t0 = now()
  const child = spawn(CORE_EXE, ['--user-data', dataDir, '--port', '0'], {
    cwd: tmpdir(),
    env: { PATH: '/usr/bin:/bin', HOME: dataDir, TMPDIR: dataDir },
    stdio: ['ignore', 'pipe', 'ignore']
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('core never reported ready')), 20000)
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d.toString()
        for (const line of buf.split('\n')) {
          try {
            if (JSON.parse(line).ready) {
              clearTimeout(timer)
              resolve()
              return
            }
          } catch {
            /* partial */
          }
        }
      })
      child.on('exit', (c) => {
        clearTimeout(timer)
        reject(new Error(`core exited early (${c})`))
      })
    })
    const readyMs = now() - t0
    await sleep(500)
    const rss = allProcesses().find((p) => p.pid === child.pid)?.rssMb ?? 0
    return { readyMs, rssMb: Math.round(rss * 10) / 10 }
  } finally {
    child.kill('SIGKILL')
    rmSync(dataDir, { recursive: true, force: true })
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
/** Compare a measurement to the thresholds. Pure, so it is unit-testable. */
export function checkThresholds(result, limits) {
  const breaches = []
  if (limits.startupMs != null && result.startup?.shellMs > limits.startupMs)
    breaches.push(`startup ${result.startup.shellMs} ms > ${limits.startupMs} ms`)
  if (limits.rssMb != null && result.memory?.settled?.totalMb > limits.rssMb)
    breaches.push(`settled RSS ${result.memory.settled.totalMb} MB > ${limits.rssMb} MB`)
  if (limits.tabMb != null && result.memory?.perTabMb > limits.tabMb)
    breaches.push(`per-tab memory ${result.memory.perTabMb} MB > ${limits.tabMb} MB`)
  return breaches
}

function printHuman(r) {
  const s = r.startup
  console.log(`startup   CDP ${s.cdpMs} ms · shell ${s.shellMs} ms · core ${s.coreMs} ms`)
  const m = r.memory.settled
  console.log(
    `memory    settled ${m.totalMb} MB ${m.metric === 'footprint' ? 'physical footprint' : 'RSS'} ` +
      `across ${m.processes} processes` +
      (m.metric === 'footprint'
        ? ` (${m.rssMb} MB RSS — RSS double-counts the shared framework)`
        : '')
  )
  for (const [k, v] of Object.entries(m.byType)) console.log(`            ${k.padEnd(28)} ${v} MB`)
  if (r.tabs.length) {
    console.log(
      `tabs      +${r.tabs.length} tabs → ${r.memory.withTabsMb} MB total; ` +
        `${r.memory.perTabMb} MB per tab (its own renderer; whole-tree delta ` +
        `${r.memory.perTabTreeMb} MB is GPU-noisy), by type:`
    )
    for (const [k, v] of Object.entries(r.memory.perTabByType ?? {})) {
      console.log(`            ${k.padEnd(28)} ${v > 0 ? '+' : ''}${v} MB`)
    }
  }
  if (r.agents) {
    console.log(
      r.agents.skipped
        ? `agents    skipped — ${r.agents.skipped}`
        : `agents    ${r.agents.started} mock agents → core ${r.agents.coreBeforeMb} → ` +
            `${r.agents.coreAfterMb} MB (+${r.agents.coreDeltaMb}, ${r.agents.perAgentMb} MB each)`
    )
  }
  const c = r.core
  console.log(
    c.skipped
      ? `core      skipped — ${c.skipped}`
      : `core      standalone ready in ${c.readyMs} ms, ${c.rssMb} MB RSS`
  )
}

async function main() {
  if (flag('help') || flag('h')) {
    console.log(HELP)
    return EXIT_OK
  }
  const browser = resolve(arg('browser', DEFAULT_BROWSER))
  const asJson = flag('json')
  if (!existsSync(browser)) {
    const msg = `no browser at ${browser} — build it, or pass --browser`
    if (asJson) console.log(JSON.stringify({ status: 'error', reason: msg }))
    else console.error(`perf: ${msg}`)
    return EXIT_ERROR
  }
  const opts = {
    browser,
    tabs: Number(arg('tabs', '5')),
    agents: Number(arg('agents', '0')),
    settleMs: Number(arg('settle-ms', '3000')),
    keepOpen: flag('keep-open')
  }
  const limits = {
    startupMs: arg('max-startup-ms') ? Number(arg('max-startup-ms')) : null,
    rssMb: arg('max-rss-mb') ? Number(arg('max-rss-mb')) : null,
    tabMb: arg('max-tab-mb') ? Number(arg('max-tab-mb')) : null
  }

  const result = await measureBrowser(opts)
  result.core = await measureCore()
  result.host = {
    platform: process.platform,
    arch: process.arch,
    cpus: (await import('node:os')).cpus().length,
    memGb: Math.round((await import('node:os')).totalmem() / 1e9)
  }
  result.breaches = checkThresholds(result, limits)
  result.status = result.breaches.length ? 'threshold-exceeded' : 'ok'

  if (asJson) console.log(JSON.stringify(result, null, 2))
  else {
    printHuman(result)
    for (const b of result.breaches) console.error(`THRESHOLD: ${b}`)
  }
  return result.breaches.length ? EXIT_THRESHOLD : EXIT_OK
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`perf: ${err.message}`)
      process.exit(EXIT_ERROR)
    })
}
