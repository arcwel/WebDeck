#!/usr/bin/env node
// Vendors native debug adapters under resources/dap-bin/<tool>/<platform>-<arch>/
// the way fetch-lsp-bins.mjs vendors language servers: codelldb (Rust, C, C++)
// from its release, digest-pinned; Delve (Go) built with `go install` when a Go
// toolchain is on this machine.
//
// Not run by the core build on purpose — codelldb unpacks to about 150 MB, and
// most installs debug JavaScript and Python, which ship. On macOS Xcode's
// lldb-dap covers Rust and C with nothing vendored; this is for a machine
// without Xcode, or for Delve. Run:
//   npm run fetch:dap                 # both
//   npm run fetch:dap -- --only codelldb | --only delve
//   npm run fetch:dap -- --json
//
// Licences: codelldb is MIT (vadimcn/codelldb); Delve is MIT (go-delve/delve).

import { execFileSync, spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import extract from 'extract-zip'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? null : args[onlyIndex + 1]
const PLATFORM_ARCH = `${process.platform}-${process.arch}`
const DAP_BIN = join(root, 'resources', 'dap-bin')

const results = []
function report(tool, result) {
  results.push({ tool, ...result })
  if (!asJson) console.log(`${tool}: ${result.detail}`)
}

/* ---------------- codelldb (release vsix, digest-pinned) ---------------- */

// Pinned so a release cannot change under us; bump deliberately and re-pin the
// digests. A platform with no digest is refused rather than trusted.
const CODELLDB_VERSION = 'v1.12.3'
const CODELLDB_SHA256 = {
  'darwin-arm64': '2f114a990e1b368dd1dbd33c80c0e719767af2d228391ec0df0571c957f9ac91'
}
const CODELLDB_ASSET = {
  'darwin-arm64': 'codelldb-darwin-arm64.vsix',
  'darwin-x64': 'codelldb-darwin-x64.vsix',
  'linux-x64': 'codelldb-linux-x64.vsix',
  'linux-arm64': 'codelldb-linux-arm64.vsix',
  'win32-x64': 'codelldb-win32-x64.vsix'
}

async function vendorCodelldb() {
  const destDir = join(DAP_BIN, 'codelldb', PLATFORM_ARCH)
  const destBin = join(
    destDir,
    'adapter',
    process.platform === 'win32' ? 'codelldb.exe' : 'codelldb'
  )
  const versionFile = join(destDir, '.version')
  if (
    existsSync(destBin) &&
    existsSync(versionFile) &&
    readFileSync(versionFile, 'utf8').trim() === CODELLDB_VERSION
  ) {
    report('codelldb', {
      vendored: true,
      path: destBin,
      detail: `${CODELLDB_VERSION} already vendored (${PLATFORM_ARCH})`
    })
    return
  }
  const asset = CODELLDB_ASSET[PLATFORM_ARCH]
  const expected = CODELLDB_SHA256[PLATFORM_ARCH]
  if (!asset) {
    report('codelldb', { vendored: false, detail: `no release asset for ${PLATFORM_ARCH}` })
    return
  }
  if (!expected) {
    report('codelldb', {
      vendored: false,
      detail: `no pinned sha256 for ${PLATFORM_ARCH}; refusing an unverified binary — add the digest to fetch-dap-bins.mjs`
    })
    return
  }
  const url = `https://github.com/vadimcn/codelldb/releases/download/${CODELLDB_VERSION}/${asset}`
  if (!asJson) console.log(`codelldb: downloading ${url}`)
  let packed
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    packed = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    report('codelldb', { vendored: false, detail: `download failed: ${error.message}` })
    return
  }
  const digest = createHash('sha256').update(packed).digest('hex')
  if (digest !== expected) {
    report('codelldb', {
      vendored: false,
      detail: `sha256 mismatch: got ${digest}, pinned ${expected}`
    })
    return
  }
  const work = join(tmpdir(), `webdeck-codelldb-${process.pid}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const vsix = join(work, asset)
  writeFileSync(vsix, packed)
  await extract(vsix, { dir: work })
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  for (const part of ['adapter', 'lldb']) {
    const from = join(work, 'extension', part)
    if (existsSync(from))
      cpSync(from, join(destDir, part), { recursive: true, verbatimSymlinks: true })
  }
  rmSync(work, { recursive: true, force: true })
  if (!existsSync(destBin)) {
    report('codelldb', {
      vendored: false,
      detail: `unpacked, but ${destBin} is missing — the vsix layout changed`
    })
    return
  }
  if (process.platform !== 'win32') {
    chmodSync(destBin, 0o755)
    for (const bin of ['lldb-argdumper', 'lldb-server', 'lldb']) {
      const p = join(destDir, 'lldb', 'bin', bin)
      if (existsSync(p)) chmodSync(p, 0o755)
    }
  }
  writeFileSync(versionFile, `${CODELLDB_VERSION}\n`)
  report('codelldb', {
    vendored: true,
    path: destBin,
    detail: `vendored ${CODELLDB_VERSION} (${PLATFORM_ARCH}, sha256 verified)`
  })
}

/* ---------------- Delve (go install) ---------------- */

async function vendorDelve() {
  const destDir = join(DAP_BIN, 'delve', PLATFORM_ARCH)
  const destBin = join(destDir, process.platform === 'win32' ? 'dlv.exe' : 'dlv')
  if (existsSync(destBin)) {
    report('delve', {
      vendored: true,
      path: destBin,
      detail: `already vendored (${PLATFORM_ARCH})`
    })
    return
  }
  const go = spawnSync('go', ['version'], { encoding: 'utf8' })
  if (go.status !== 0) {
    report('delve', {
      vendored: false,
      detail:
        'no Go toolchain on this machine; Delve is not built. Install Go and re-run, or ' +
        '`go install github.com/go-delve/delve/cmd/dlv@latest` — the core also finds dlv on PATH and in ~/go/bin.'
    })
    return
  }
  mkdirSync(destDir, { recursive: true })
  try {
    // GOBIN must be absolute; `go install` drops the binary there named `dlv`.
    execFileSync('go', ['install', 'github.com/go-delve/delve/cmd/dlv@latest'], {
      stdio: asJson ? 'pipe' : 'inherit',
      env: { ...process.env, GOBIN: resolve(destDir) }
    })
  } catch (error) {
    report('delve', {
      vendored: false,
      detail: `go install failed: ${error.message.split('\n')[0]}`
    })
    return
  }
  if (!existsSync(destBin)) {
    report('delve', {
      vendored: false,
      detail: `go install completed but ${destBin} is missing — check GOBIN/GOOS`
    })
    return
  }
  chmodSync(destBin, 0o755)
  const version = spawnSync(destBin, ['version'], { encoding: 'utf8' })
  const line =
    version.status === 0 ? (version.stdout.match(/Version: (\S+)/)?.[1] ?? 'unknown') : 'unknown'
  writeFileSync(join(destDir, '.version'), `${line}\n`)
  report('delve', {
    vendored: true,
    path: destBin,
    detail: `built ${line} with ${go.stdout.trim()} (${PLATFORM_ARCH})`
  })
}

if (!only || only === 'codelldb') await vendorCodelldb()
if (!only || only === 'delve') await vendorDelve()
if (asJson) console.log(JSON.stringify({ platform: PLATFORM_ARCH, results }))
