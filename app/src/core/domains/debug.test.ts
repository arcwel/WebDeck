// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { setCoreEnv } from '../env'

/**
 * The adapter table and its resolver: which languages have a debugger on this
 * machine, found where, speaking which transport. The socket path is proven
 * with a fake adapter that prints Delve's banner; the real js-debug session is
 * covered by the fork verification, not here.
 */
const dir = join(tmpdir(), `wd-debug-${process.pid}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'resources', 'dap-bin', 'delve', `${process.platform}-${process.arch}`), {
  recursive: true
})
setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

const { DEBUG_LANGUAGES, describeDebugAdapter, findLldbDap, resolveDebugAdapter } =
  await import('./debug')

beforeAll(() => {
  // A vendored "dlv" that only prints the banner Delve prints.
  const dlv = join(
    dir,
    'resources',
    'dap-bin',
    'delve',
    `${process.platform}-${process.arch}`,
    'dlv'
  )
  writeFileSync(dlv, '#!/bin/sh\necho "DAP server listening at: 127.0.0.1:43210"\nsleep 2\n')
  chmodSync(dlv, 0o755)
})

describe('resolveDebugAdapter', () => {
  it('knows five languages and refuses the rest', () => {
    expect(DEBUG_LANGUAGES).toEqual(['node', 'python', 'go', 'rust', 'c'])
    expect(resolveDebugAdapter('cobol')).toEqual({
      error: "No debug adapter configured for 'cobol'."
    })
  })

  it('finds a vendored Delve and reaches it over a socket with its own banner', () => {
    const go = resolveDebugAdapter('go')
    expect('error' in go).toBe(false)
    if ('error' in go) return
    expect(go.adapterId).toBe('go')
    expect(go.transport).toBe('socket')
    expect(go.args).toEqual(['dap', '--listen=127.0.0.1:0'])
    expect(go.portPattern?.exec('DAP server listening at: 127.0.0.1:43210')?.[1]).toBe('43210')
  })

  it('describes an adapter to the renderer without its command line', () => {
    const go = describeDebugAdapter('go')
    expect(go).toEqual({ adapterId: 'go', transport: 'socket' })
    expect(describeDebugAdapter('nope')).toMatchObject({ error: expect.stringContaining('nope') })
  })

  it('uses lldb-dap for Rust and C on a Mac with Xcode, over stdio', () => {
    const lldbDap = findLldbDap()
    const rust = resolveDebugAdapter('rust')
    if (!lldbDap) {
      expect(rust).toMatchObject({ error: expect.stringContaining('lldb adapter') })
      return
    }
    expect('error' in rust).toBe(false)
    if ('error' in rust) return
    expect(['lldb', 'lldb-dap']).toContain(rust.adapterId)
    if (rust.adapterId === 'lldb-dap') {
      expect(rust.transport).toBe('stdio')
      expect(rust.command).toBe(lldbDap)
    }
    expect(resolveDebugAdapter('c')).toMatchObject({ adapterId: rust.adapterId })
  })

  it('reports why Python cannot start rather than throwing, when it cannot', () => {
    const python = resolveDebugAdapter('python')
    if ('error' in python) expect(python.error).toMatch(/python3/)
    else expect(python).toMatchObject({ adapterId: 'debugpy', transport: 'stdio' })
  })
})
