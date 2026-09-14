#!/usr/bin/env node
// Builds webdeck-apple-llm, the helper that gives Ask Apple's on-device model
// (Foundation Models, macOS 26). Swift, one file, compiled with the system
// toolchain into resources/apple-llm/<platform>-<arch>/ where the core finds it
// the way it finds the vendored language servers.
//
// Never fails a core build: on another OS, or without swiftc or the macOS 26
// SDK, it says so and the provider reports "not in this build". Run alone:
//   node scripts/build-apple-llm.mjs [--json] [--force]

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const force = args.includes('--force')

const source = join(root, 'native', 'apple-llm', 'main.swift')
const outDir = join(root, 'resources', 'apple-llm', `${process.platform}-${process.arch}`)
const out = join(outDir, 'webdeck-apple-llm')

function report(result) {
  if (asJson) console.log(JSON.stringify(result))
  else console.log(`apple-llm: ${result.detail}`)
}

if (process.platform !== 'darwin') {
  report({ built: false, detail: 'skipped — Apple’s on-device model is macOS only' })
  process.exit(0)
}
const swiftc = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' })
if (swiftc.status !== 0) {
  report({ built: false, detail: 'skipped — no Swift toolchain (xcrun --find swiftc failed)' })
  process.exit(0)
}
const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' })
const sdkVersion = sdk.status === 0 ? sdk.stdout.trim() : '0'
if (Number(sdkVersion.split('.')[0]) < 26) {
  report({
    built: false,
    detail: `skipped — macOS SDK ${sdkVersion} has no Foundation Models (needs 26)`
  })
  process.exit(0)
}
if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(source).mtimeMs) {
  report({ built: true, path: out, detail: `up to date (${out})` })
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })
try {
  // Through xcrun, which sets the SDK path the bare compiler binary does not.
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      '-target',
      `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx26.0`,
      source,
      '-o',
      out
    ],
    { stdio: asJson ? 'pipe' : 'inherit' }
  )
} catch (error) {
  report({ built: false, detail: `swiftc failed: ${error.message.split('\n')[0]}` })
  process.exit(0)
}
report({ built: true, path: out, detail: `built ${out}` })
