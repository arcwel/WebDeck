// Where the Chromium checkout is, answered in one place.
//
// The path used to be a string literal in seven scripts and `checkout` in
// chromium/fork.json. Moving the build to another drive meant editing all
// eight and finding the ones you missed by running them, so it is declared
// once here and everything else asks.
//
// Resolution order, first hit wins:
//
//   1. an explicit `--chromium <path>` on the command line
//   2. the WEBDECK_CHROMIUM_SRC environment variable
//   3. `checkout` in chromium/fork.json  <- the recorded answer
//
// fork.json is the recorded one because it is already the file that pins the
// fork, it is in git, and `verify:patches` and `rebase-fork` read it.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(appRoot)

/** `checkout` from chromium/fork.json, or '' when it cannot be read. */
export function recordedCheckout() {
  try {
    const forkPath = join(repoRoot, 'chromium', 'fork.json')
    return JSON.parse(readFileSync(forkPath, 'utf8')).checkout ?? ''
  } catch {
    return ''
  }
}

/**
 * The Chromium checkout, absolute.
 *
 * @param argv typically process.argv
 * @param flag the command-line flag to honour (default `--chromium`)
 */
export function chromiumSrc(argv = process.argv, flag = '--chromium') {
  const i = argv.indexOf(flag)
  const fromFlag = i !== -1 && argv[i + 1] ? argv[i + 1] : ''
  const chosen = fromFlag || process.env.WEBDECK_CHROMIUM_SRC || recordedCheckout()
  return chosen ? resolve(chosen) : ''
}

/**
 * A path inside the checkout's build directory.
 *
 * The build directory itself is not configurable: `out/webdeck-release` is the
 * one this project builds (chromium/SETUP.md), and the old component build
 * `out/webdeck` is no longer produced.
 */
export function buildPath(...parts) {
  const src = chromiumSrc()
  return src ? join(src, 'out', 'webdeck-release', ...parts) : ''
}

/** The built app bundle's executable, for the verify scripts. */
export function builtAppBinary() {
  return buildPath('Arcwel WebDeck.app', 'Contents', 'MacOS', 'Arcwel WebDeck')
}

/** True when the checkout resolves to a real git checkout on this machine. */
export function checkoutExists() {
  const src = chromiumSrc()
  return Boolean(src) && existsSync(join(src, '.git'))
}
