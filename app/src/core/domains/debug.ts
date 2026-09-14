import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { connect, createServer, type Socket } from 'node:net'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { coreEnv } from '../env'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import type { Message } from 'vscode-jsonrpc'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import { coreBroadcast } from '../notify'
import { getCurrentWorkspace } from './workspace'
import { core } from '../rpc'
import { asString } from '../coerce'

/**
 * Debugging over DAP (task 12.4).
 *
 * The adapter is Microsoft's **js-debug**, vendored at install time from its
 * GitHub release (MIT). The Open VSX vsix could not be used: it packages the
 * *extension*, which needs an extension host to run — and ours is blocked on
 * origin isolation (task 12.8). The standalone `dapDebugServer.js` in the
 * release has no such dependency, which is what makes debugging shippable now.
 *
 * It covers `pwa-node` (Node and TypeScript, with source maps) and
 * `pwa-chrome` / `pwa-msedge` (the browser), so one adapter serves both halves
 * of an "IDE and browser" app.
 *
 * **Multiple connections, one adapter.** js-debug is a parent/child debugger:
 * the connection that handles `launch` does not own the debuggee. It sends a
 * `startDebugging` *reverse request* asking the client to open another
 * connection for the child session, and it is the child that hits breakpoints
 * and reports stack frames. A client that ignores that request connects, runs,
 * and never stops anywhere — so this module keeps a map of connections rather
 * than a single one, and tags every message with the connection it belongs to.
 *
 * Transport: main owns the process and the sockets and forwards decoded
 * messages to the renderer over IPC, the same shape as the language client in
 * task 12.2. The renderer never sees a socket or a Content-Length header.
 *
 * **Other languages.** The same module starts debugpy (Python), Delve (Go) and
 * lldb — codelldb or Xcode's lldb-dap — for Rust, C and C++, each found on the
 * machine or vendored under resources/dap-bin. Delve and codelldb print a port
 * and are reached over a socket like js-debug; debugpy and lldb-dap speak DAP
 * on their own stdio, so their one connection is the child's pipes.
 */

interface Connection {
  reader: StreamMessageReader
  writer: StreamMessageWriter
  close: () => void
}

let adapter: ChildProcess | null = null
let adapterPort = 0
let adapterTransport: Transport = 'socket'
const connections = new Map<string, Connection>()

/** Where the vendored js-debug lives: the core runtime dir, or the dev checkout. */
function adapterPath(): string | null {
  const candidates = [
    join(coreEnv().appDir, 'resources', 'js-debug', 'src', 'dapDebugServer.js'),
    join(process.cwd(), 'resources', 'js-debug', 'src', 'dapDebugServer.js')
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

/** A native adapter under resources/dap-bin/<rel>, in the runtime or the dev checkout. */
function vendoredPath(rel: string): string | null {
  let appResources = ''
  try {
    appResources = join(coreEnv().appDir, 'resources', 'dap-bin', rel)
  } catch {
    // Before setCoreEnv(): only the dev candidate applies.
  }
  const candidates = [appResources, join(process.cwd(), 'resources', 'dap-bin', rel)]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

function onPath(binary: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, binary))) return join(dir, binary)
  }
  return null
}

const PLATFORM_DIR = `${process.platform}-${process.arch}`

/** Delve: vendored, on PATH, or where `go install` puts it. */
export function findDelve(): string | null {
  return (
    vendoredPath(join('delve', PLATFORM_DIR, 'dlv')) ??
    onPath('dlv') ??
    [join(homedir(), 'go', 'bin', 'dlv')].find((p) => existsSync(p)) ??
    null
  )
}

/** codelldb: vendored, or the newest copy VS Code's extension installed. */
export function findCodelldb(): string | null {
  const vendored = vendoredPath(join('codelldb', PLATFORM_DIR, 'adapter', 'codelldb'))
  if (vendored) return vendored
  const extensions = join(homedir(), '.vscode', 'extensions')
  if (!existsSync(extensions)) return null
  const candidates = readdirSync(extensions)
    .filter((name) => name.startsWith('vadimcn.vscode-lldb-'))
    .sort()
    .reverse()
    .map((name) => join(extensions, name, 'adapter', 'codelldb'))
  return candidates.find((p) => existsSync(p)) ?? null
}

/** lldb-dap: Xcode ships it on macOS; LLVM installs put it on PATH. */
export function findLldbDap(): string | null {
  const fromPath = onPath('lldb-dap')
  if (fromPath) return fromPath
  if (process.platform !== 'darwin') return null
  const found = spawnSync('xcrun', ['--find', 'lldb-dap'], { encoding: 'utf8' })
  const path = found.status === 0 ? found.stdout.trim() : ''
  return path && existsSync(path) ? path : null
}

export function isDebuggerAvailable(language = 'node'): boolean {
  return !('error' in resolveDebugAdapter(language))
}

/**
 * Debug adapters by language id.
 *
 * `node` is Microsoft js-debug (pwa-node / pwa-chrome / pwa-msedge), vendored
 * and Node-based, riding `ELECTRON_RUN_AS_NODE` so a script runs inside the
 * SEA. `python` is debugpy on the user's own interpreter. `go` is Delve, and
 * `rust` and `c` are lldb — codelldb when vendored (`npm run fetch:dap`) or
 * installed with VS Code, else Xcode's lldb-dap. Each entry says how the
 * adapter is reached and how it speaks: over a socket whose port it prints,
 * or over its own stdio. Adding a language is one entry here plus its launch
 * shape in the renderer.
 */
type Transport = 'socket' | 'stdio'

export interface ResolvedAdapter {
  command: string
  args: string[]
  transport: Transport
  /** What the client sends as `adapterID`, and how the renderer shapes the launch. */
  adapterId: 'pwa-node' | 'debugpy' | 'go' | 'lldb' | 'lldb-dap'
  /** For a socket adapter that announces its port: the line it prints, with the port captured. */
  portPattern?: RegExp
  /** For a socket adapter that must be told its port: the flags that carry one we picked. */
  assignPort?: (port: number) => string[]
  env?: Record<string, string>
}

const ADAPTER_NOTES: Record<string, string> = {
  node: 'Microsoft js-debug (pwa-node / pwa-chrome / pwa-msedge), vendored and Node-based.',
  python: 'debugpy.adapter via system python3 (interpreter dependency, not bundled).',
  go: 'Delve (`dlv dap`): vendored by fetch-dap-bins.mjs on a machine with Go, or on PATH.',
  rust: 'codelldb (vendored or from VS Code), else Xcode’s lldb-dap.',
  c: 'codelldb (vendored or from VS Code), else Xcode’s lldb-dap.'
}

export const DEBUG_LANGUAGES = Object.keys(ADAPTER_NOTES)

/** Locate a system Python 3 interpreter, or null. Unlike the Node adapters,
 *  debugpy needs a real interpreter on the host; probe the usual names rather
 *  than assume one is installed. */
function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
}

/**
 * Resolve how a language's debug adapter would launch, or a clear reason it
 * cannot on this machine.
 *
 * Non-throwing, mirroring the language-server resolver: a missing toolchain must
 * degrade to "no debugging for this language", never crash the service.
 */
export function resolveDebugAdapter(id: string): ResolvedAdapter | { error: string } {
  if (!(id in ADAPTER_NOTES)) return { error: `No debug adapter configured for '${id}'.` }

  if (id === 'node') {
    const path = adapterPath()
    if (!path)
      return { error: 'The debug adapter is not installed. Run scripts/fetch-js-debug.mjs.' }
    // Same argv js-debug's own start path uses: port 0 = pick a free port.
    return {
      command: process.execPath,
      args: [path, '0', '127.0.0.1'],
      transport: 'socket',
      adapterId: 'pwa-node',
      portPattern: /listening at [^:]+:(\d+)/i,
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  }

  if (id === 'python') {
    const python = findPython()
    if (!python) {
      return {
        error:
          'Python debugging needs a system Python 3 with debugpy installed ' +
          '(`pip install debugpy`); no python3 was found on PATH.'
      }
    }
    return {
      command: python,
      args: ['-m', 'debugpy.adapter'],
      transport: 'stdio',
      adapterId: 'debugpy'
    }
  }

  if (id === 'go') {
    const dlv = findDelve()
    if (!dlv) {
      return {
        error:
          'Go debugging needs Delve. Install it with ' +
          '`go install github.com/go-delve/delve/cmd/dlv@latest`, or run `npm run fetch:dap` ' +
          'on a machine with Go.'
      }
    }
    return {
      command: dlv,
      args: ['dap', '--listen=127.0.0.1:0'],
      transport: 'socket',
      adapterId: 'go',
      portPattern: /listening at: [^:]+:(\d+)/i
    }
  }

  // rust, c
  const codelldb = findCodelldb()
  if (codelldb) {
    // codelldb listens on the port it is given and prints nothing, so the
    // core picks a free port and connects once the adapter accepts.
    return {
      command: codelldb,
      args: [],
      transport: 'socket',
      adapterId: 'lldb',
      assignPort: (port) => ['--port', String(port)]
    }
  }
  const lldbDap = findLldbDap()
  if (lldbDap) return { command: lldbDap, args: [], transport: 'stdio', adapterId: 'lldb-dap' }
  return {
    error:
      `${id === 'rust' ? 'Rust' : 'C and C++'} debugging needs an lldb adapter: ` +
      'Xcode’s lldb-dap (install Xcode), codelldb from VS Code’s CodeLLDB extension, or ' +
      '`npm run fetch:dap`.'
  }
}

/** A port nobody holds right now: bind to 0, read what the OS gave, release it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/**
 * Connect to the adapter's assigned port, retrying until it accepts. The
 * socket is the session: codelldb without --multi-session serves the first
 * connection and no other, so a probe that connects and hangs up would take
 * the only seat.
 */
function connectWhenReady(child: ChildProcess, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let exited = false
    child.once('exit', () => {
      exited = true
    })
    const attempt = (): void => {
      if (exited) {
        reject(new Error('the debug adapter exited before it was ready'))
        return
      }
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => resolve(socket))
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error('the debug adapter did not start'))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

/** Wait for the adapter to print its listening banner, then read the port. */
function waitForPort(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the debug adapter did not start')), timeoutMs)
    let buffered = ''
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString()
      const match = pattern.exec(buffered)
      if (!match) return
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      resolve(Number(match[1]))
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('the debug adapter exited before it was ready'))
    })
  })
}

function listen(id: string, reader: StreamMessageReader): void {
  reader.listen((message: Message) =>
    coreBroadcast(IpcEvents.debugMessage, { sessionId: id, message }, null)
  )
  reader.onError(() => closeConnection(id))
}

/** Open one DAP connection to the running socket adapter under the given id. */
function openSocketConnection(id: string, existing?: Socket): Connection {
  const socket = existing ?? connect(adapterPort, '127.0.0.1')
  const reader = new StreamMessageReader(socket)
  const writer = new StreamMessageWriter(socket)
  listen(id, reader)
  socket.on('error', () => closeConnection(id))
  const connection: Connection = {
    reader,
    writer,
    close: () => {
      reader.dispose()
      writer.dispose()
      socket.destroy()
    }
  }
  connections.set(id, connection)
  return connection
}

/** The one connection a stdio adapter has: its own stdout and stdin. */
function openStdioConnection(id: string, child: ChildProcess): Connection {
  const reader = new StreamMessageReader(child.stdout!)
  const writer = new StreamMessageWriter(child.stdin!)
  listen(id, reader)
  const connection: Connection = {
    reader,
    writer,
    close: () => {
      reader.dispose()
      writer.dispose()
    }
  }
  connections.set(id, connection)
  return connection
}

function closeConnection(id: string): void {
  const connection = connections.get(id)
  if (!connection) return
  connections.delete(id)
  connection.close()
}

/**
 * Start the adapter for a language and open the root connection.
 *
 * One adapter process at a time: a second Start replaces the first rather than
 * leaving an orphan holding a port and a debuggee.
 */
export async function startDebugSession(
  language = 'node'
): Promise<{ error?: string; adapterId?: ResolvedAdapter['adapterId'] }> {
  stopDebugSession()

  const resolved = resolveDebugAdapter(language)
  if ('error' in resolved) return { error: resolved.error }
  const cwd = getCurrentWorkspace()?.path
  if (!cwd) return { error: 'No workspace open.' }

  let assigned = 0
  if (resolved.assignPort) {
    try {
      assigned = await freePort()
    } catch (error) {
      return { error: String(error instanceof Error ? error.message : error) }
    }
  }
  const args = assigned ? [...resolved.args, ...resolved.assignPort!(assigned)] : resolved.args
  const child = spawn(resolved.command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(resolved.env ?? {}) }
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.error(`[dap ${resolved.adapterId}] ${text}`)
  })
  child.on('error', (error) => console.error(`[dap ${resolved.adapterId}] ${error.message}`))

  adapterTransport = resolved.transport
  let rootSocket: Socket | undefined
  if (resolved.transport === 'socket') {
    try {
      if (assigned) {
        rootSocket = await connectWhenReady(child, assigned, 20000)
        adapterPort = assigned
      } else {
        adapterPort = await waitForPort(child, resolved.portPattern!, 20000)
      }
    } catch (error) {
      child.kill()
      return { error: String(error instanceof Error ? error.message : error) }
    }
  }

  child.on('exit', () => {
    if (adapter !== child) return
    adapter = null
    for (const id of [...connections.keys()]) closeConnection(id)
    coreBroadcast(IpcEvents.debugExit, null, null)
  })

  adapter = child
  if (resolved.transport === 'socket') openSocketConnection('root', rootSocket)
  else openStdioConnection('root', child)
  return { adapterId: resolved.adapterId }
}

/**
 * Open a child session (the `startDebugging` reverse request).
 *
 * The child connects to the same adapter; js-debug matches it to the pending
 * target carried in the configuration the renderer echoes back. An adapter on
 * stdio has one session and no way to open another.
 */
export function attachDebugChild(id: string): { error?: string } {
  if (!adapter) return { error: 'No debug session is running.' }
  if (connections.has(id)) return {}
  if (adapterTransport !== 'socket') return { error: 'This debug adapter runs one session.' }
  openSocketConnection(id)
  return {}
}

export function sendToDebugAdapter(sessionId: string, message: Message): void {
  const connection = connections.get(sessionId)
  if (!connection) return
  void connection.writer.write(message).catch(() => {
    // The adapter died between the check and the write; the exit handler has
    // already told the renderer.
  })
}

export function stopDebugSession(): void {
  for (const id of [...connections.keys()]) closeConnection(id)
  const child = adapter
  adapter = null
  adapterPort = 0
  child?.kill()
}

/** What the renderer may know about an adapter: its id and transport, or why it is absent. */
export function describeDebugAdapter(
  language: string
): { adapterId: ResolvedAdapter['adapterId']; transport: Transport } | { error: string } {
  const resolved = resolveDebugAdapter(language)
  return 'error' in resolved
    ? resolved
    : { adapterId: resolved.adapterId, transport: resolved.transport }
}

export function registerDebugRpc(): void {
  core.register(IpcChannels.debugAvailable, (language) =>
    isDebuggerAvailable(asString(language) ?? 'node')
  )
  core.register(IpcChannels.debugResolve, (language) =>
    describeDebugAdapter(asString(language) ?? 'node')
  )
  core.register(IpcChannels.debugStart, (language) =>
    startDebugSession(asString(language) ?? 'node')
  )
  core.register(IpcChannels.debugAttachChild, (sessionId) => {
    const id = asString(sessionId)
    return id ? attachDebugChild(id) : { error: 'bad arguments' }
  })
  core.register(IpcChannels.debugStop, () => stopDebugSession())
  core.registerNotify(IpcChannels.debugSend, (sessionId, message) => {
    const id = asString(sessionId)
    if (id && message && typeof message === 'object') {
      sendToDebugAdapter(id, message as Parameters<typeof sendToDebugAdapter>[1])
    }
  })
}
