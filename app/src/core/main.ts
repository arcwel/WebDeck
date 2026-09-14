import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveUserDataDir } from './node-env'
import { startWebdeckCore } from './server'

/**
 * `webdeck-core` executable entry point.
 *
 * This is what the Chromium fork spawns: a plain Node process serving the whole
 * IDE/agent surface over a loopback WebSocket, with no Electron anywhere. The
 * browser connects to it, renders `chrome://webdeck`, and drives the same
 * handlers the Electron build calls over IPC today.
 *
 * Usage:
 *   webdeck-core [--port N] [--host H] [--user-data DIR] [--port-file PATH]
 *   webdeck-core models <list|use|pull|remove|test|recommend|endpoint> … (cli-models.ts)
 *
 * The port defaults to 0 (the OS picks a free one) and is printed on stdout as
 * JSON, so a supervising process knows the core came up.
 *
 * The connection TOKEN is deliberately NOT printed. It is a full-privilege
 * credential, and this process's stdout is inherited by whoever spawned us —
 * terminal scrollback, a CI log, the browser's own log. It goes only into the
 * 0600 handoff file, which is written to `--port-file`, or, when that is
 * omitted, to `<user-data>/core-port.json` so a hand-launched core is still
 * reachable by anything that already knows its data directory.
 */

function arg(name: string): string | undefined {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index !== -1 && index + 1 < process.argv.length) return process.argv[index + 1]
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`))
  return inline ? inline.slice(flag.length + 1) : undefined
}

/** The handoff file, defaulted into the data directory when none was named. */
function handoffFile(userDataDir?: string): string {
  const named = arg('port-file')
  if (named) return named
  const dir = resolveUserDataDir(userDataDir)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'core-port.json')
}

/**
 * Loopback addresses. The core serves the user's files, spawns terminals and
 * holds their provider key, so binding it to a routable interface exposes all
 * of that to the network — and the token was designed as a boundary against
 * other local processes, not against the internet.
 *
 * The docs already claimed "loopback only, by design"; nothing enforced it, so
 * `--host 0.0.0.0` quietly did exactly the wrong thing.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function requireLoopback(host: string | undefined): string | undefined {
  if (host === undefined || LOOPBACK.has(host)) return host
  process.stderr.write(
    `webdeck-core: refusing --host ${host}. This service exposes the user's files, ` +
      `terminals and API keys; it binds loopback only.\n`
  )
  process.exit(2)
}

/**
 * Where the parts that cannot live inside the executable are kept.
 *
 * The shipped core is a single Mach-O with the JS bundle sealed inside it, but
 * three things have to stay on disk beside it: node-pty (a native addon —
 * dlopen needs a file), reveal.js (data files `slides.ts` resolves), and the
 * vendored js-debug adapter. `build-core.mjs` writes them to a
 * `webdeck-core-runtime` directory next to the binary, and the SEA prologue
 * exports the same path so module resolution and `appDir` agree.
 *
 * Running the plain `.cjs` bundle under a dev Node has neither, so fall back to
 * the working directory, which is what this always used.
 */
function runtimeDir(): string | undefined {
  const named = process.env.WEBDECK_CORE_RUNTIME
  if (named) return named
  const beside = join(dirname(process.execPath), 'webdeck-core-runtime')
  if (existsSync(beside)) return beside
  // The app bundle keeps it under Contents/Resources (codesign rejects a
  // directory under Contents/MacOS); the SEA prologue looks there too.
  const inBundle = join(dirname(process.execPath), '..', 'Resources', 'webdeck-core-runtime')
  return existsSync(inBundle) ? inBundle : undefined
}

/**
 * Which browser the agent drives. `isolated` (default) spawns a throwaway
 * profile over CDP — Agent Vision and the navigation guard are complete there.
 * `session` drives the user's own tabs through the page; it works end to end
 * for open/read/click/type but its event forwarding does not yet feed vision
 * or the guard (verify-session-mode.mjs), so it is opt-in:
 * `--agent-browser session` or WEBDECK_AGENT_BROWSER=session.
 */
function agentBrowserMode(): 'session' | 'isolated' {
  const raw = arg('agent-browser') ?? process.env.WEBDECK_AGENT_BROWSER ?? 'isolated'
  if (raw === 'session' || raw === 'isolated') return raw
  process.stderr.write(
    `webdeck-core: unknown --agent-browser "${raw}"; expected session|isolated\n`
  )
  process.exit(2)
}

async function main(): Promise<void> {
  // Subcommands do one thing and exit; only the bare invocation serves.
  if (process.argv[2] === 'models') {
    const { runModelsCli } = await import('./cli-models')
    process.exit(await runModelsCli(process.argv.slice(3)))
  }
  const portArg = arg('port')
  const userDataDir = arg('user-data')
  const appDir = runtimeDir()

  // The pty host fallback shells out to `node`. In the packaged build there is
  // none — but this executable *is* a Node, and honours ELECTRON_RUN_AS_NODE to
  // say so, so point the fallback at ourselves rather than at a machine that
  // may have no Node at all.
  process.env.AGWEB_NODE ??= process.execPath

  const handle = await startWebdeckCore({
    port: portArg ? Number(portArg) : 0,
    host: requireLoopback(arg('host')),
    userDataDir,
    appDir,
    portFile: handoffFile(userDataDir),
    agentBrowserMode: agentBrowserMode()
  })

  // The one thing a supervisor needs from stdout: where to connect.
  process.stdout.write(`${JSON.stringify({ ready: true, port: handle.port })}\n`)

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  /**
   * Exit when whoever started us goes away.
   *
   * The browser spawns this process and has a Shutdown() to stop it — which
   * nothing calls, and could not be relied on anyway: the service is a
   * never-destructed singleton, and a browser that crashes runs no cleanup at
   * all. Left alone, this process outlived the browser holding the user's
   * provider key in memory, a listening socket, and a handoff file on disk
   * naming the token to reach it.
   *
   * Reparenting is the portable signal: on POSIX an orphan is adopted by init,
   * so a ppid that changes to 1 means the parent is gone. Checked on a timer
   * rather than a signal because there is no portable "parent died" signal, and
   * a few seconds of overrun is not worth a platform-specific mechanism.
   */
  const parentAtStart = process.ppid
  const orphanWatch = setInterval(() => {
    const parent = process.ppid
    if (parent === parentAtStart || parent === 0) return
    process.stderr.write('webdeck-core: the browser that started it is gone; exiting\n')
    clearInterval(orphanWatch)
    shutdown()
  }, 2_000)
  // Never hold the process open on our own account.
  orphanWatch.unref()
}

main().catch((error: unknown) => {
  process.stderr.write(`webdeck-core failed to start: ${(error as Error).message}\n`)
  process.exit(1)
})
