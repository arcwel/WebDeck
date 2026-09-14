#!/usr/bin/env node
// Turns a built Chromium fork into a .dmg a tester can mount, and says out loud
// what is wrong with the one it just made.
//
// Two modes, same pipeline:
//
//   default        ad-hoc (`codesign -s -`). No keychain, no Apple credential.
//                  The mechanics run end to end — inside-out signing order, the
//                  sealed resource set, the entitlements, hdiutil, the mount —
//                  but Gatekeeper rejects the result, so it is for machines you
//                  control.
//   --identity     a real Developer ID Application certificate, with the
//                  hardened runtime and a secure timestamp. Add
//                  --notary-profile and the app and the dmg are submitted to
//                  Apple, stapled, and checked with spctl. That produces the
//                  ordinary install: mount, drag to Applications, double-click,
//                  no warning.
//
// The credential itself is never seen here: --notary-profile names a keychain
// item the user created with `notarytool store-credentials`. See
// chromium/RELEASING.md.
//
// It refuses builds that cannot honestly be packaged. The one that matters is
// `is_component_build = true`: that build's Framework binary is a 16 KB stub
// that reexports 520 dylibs sitting loose in the build directory. A .dmg of it
// looks exactly like a real one and is not — so it takes an explicit
// --allow-component-build, and everything it produces is named DEV.
//
// Usage:
//   node scripts/package-fork.mjs [--build-dir <dir>] [--out <dir>] [--json]
//                                 [--allow-component-build] [--skip-dmg]
//                                 [--format UDZO|UDBZ|UDRO] [--no-verify]
//                                 [--keep-stage]
// Exit codes: 0 packaged · 1 the build is unfit, or packaging failed · 2 could not run
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const DEFAULT_BUILD_DIR = '/Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`package-fork — assemble the built fork into a mountable .dmg

  --build-dir <dir>          the gn out dir to package (default: the BG_Dev
                             component build). READ ONLY — nothing is built and
                             nothing in it is modified.
  --out <dir>               where to write (default: <build-dir>-package, so the
                             ~1 GB of a component build never lands on a synced
                             drive)
  --allow-component-build   package an is_component_build=true tree anyway. The
                             result is labelled DEV and is not distributable.
  --skip-dmg                stage and sign only, no disk image
  --format <fmt>            UDZO (default, zlib) · UDBZ (bzip2, smaller/slower)
                             · UDRO (uncompressed, fastest)
  --no-verify               skip the mount-and-launch check of the finished dmg
  --keep-stage              keep the staging tree next to the dmg
  --json                    machine-readable result

Distribution:
  --identity <name|auto>    sign with a real certificate instead of ad-hoc.
                            "auto" picks the one Developer ID Application
                            identity in the keychain. Turns on the hardened
                            runtime and a secure timestamp, both of which
                            Apple requires before it will notarize.
  --notary-profile <name>   submit the app and the dmg to Apple's notary
                            service and staple the tickets, using credentials
                            you stored once with:
                              xcrun notarytool store-credentials <name> \
                                --apple-id <you@example.com> --team-id <TEAM>
                            Requires --identity. This script never sees the
                            password; the keychain hands it to notarytool.
  --allow-dev-keychain      package a build compiled with
                            webdeck_dev_keychain = true anyway (it stores the
                            cookie/password key as a plaintext file, so it is
                            never distributable).

Exit: 0 packaged · 1 build unfit or packaging failed · 2 could not run`)
  process.exit(0)
}

const buildDir = resolve(arg('build-dir', DEFAULT_BUILD_DIR))
const outDir = resolve(arg('out', `${buildDir}-package`))
const dmgFormat = arg('format', 'UDZO')
const asJson = flag('json')
const identityArg = arg('identity', '-')
const notaryProfile = arg('notary-profile', null)
// Notarizing needs a certificate: Apple has nothing to check an ad-hoc
// signature against, and the submission would be rejected after the upload.
if (notaryProfile && identityArg === '-')
  cannotRun('--notary-profile needs --identity — Apple will not notarize ad-hoc signed code')

// ── the result ledger ───────────────────────────────────────────────────────
// ok    measured, the property holds
// warn  measured, holds, but a human should read it
// fail  measured, does NOT hold → the build is unfit → exit 1
const checks = []
const ok = (name, detail) => checks.push({ name, status: 'ok', detail })
const warn = (name, detail) => checks.push({ name, status: 'warn', detail })
const fail = (name, detail) => checks.push({ name, status: 'fail', detail })

// Reasons the artifact must not be handed to anyone outside this machine.
// These are findings, not errors: the run still produces a dmg, clearly labelled.
const blockers = []
const blocker = (title, detail) => blockers.push({ title, detail })

/** Fail with exit 2: we could not run at all, which is NOT a pass. */
function cannotRun(message) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason: message, checks }, null, 2))
  else console.error(`cannot run: ${message}`)
  process.exit(2)
}

/** Run a command, never throwing. Returns { code, out, err }. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) return { code: -1, out: '', err: r.error.message }
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

/** Run a command and throw with its stderr if it fails. */
function must(cmd, args, what) {
  const r = run(cmd, args)
  if (r.code !== 0)
    throw new Error(`${what}: ${(r.err || r.out).trim().split('\n').slice(-3).join(' / ')}`)
  return r.out
}

// ── 0. can this machine do the job at all ───────────────────────────────────

if (process.platform !== 'darwin') cannotRun('macOS only — codesign and hdiutil are not portable')
for (const tool of ['codesign', 'hdiutil', 'otool', 'plutil']) {
  if (run('/usr/bin/which', [tool]).code !== 0)
    cannotRun(`${tool} not found — install the Xcode command line tools`)
}
if (!existsSync(buildDir)) cannotRun(`no build directory at ${buildDir}`)
if (!existsSync(join(buildDir, 'args.gn'))) {
  cannotRun(`${buildDir} has no args.gn — that is not a gn build directory`)
}

// Packaging a tree that a build is actively rewriting produces an artifact that
// matches no source revision. siso leaves .siso_lock behind after it exits, so
// the file's presence proves nothing; the pid inside it does.
const lockFile = join(buildDir, '.siso_lock')
if (existsSync(lockFile)) {
  const pid = Number(/pid=(\d+)/.exec(readFileSync(lockFile, 'utf8'))?.[1])
  if (Number.isFinite(pid)) {
    const ps = run('/bin/ps', ['-p', String(pid), '-o', 'command='])
    if (ps.code === 0 && ps.out.trim()) {
      cannotRun(
        `a build is writing ${buildDir} right now (pid ${pid}: ${ps.out.trim().slice(0, 80)}) — wait for it to finish`
      )
    }
  }
}

// ── 1. what did we get ──────────────────────────────────────────────────────

/** Parse args.gn well enough to read the handful of args that decide packaging. */
function readArgsGn(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return out
}
const gnArgs = readArgsGn(join(buildDir, 'args.gn'))

// The development keychain replaces the login-Keychain item that encrypts
// cookies and saved passwords with a 0600 file in the profile directory. That
// is a deliberate convenience for unsigned dev builds (no "Safe Storage"
// prompt); shipping it would hand every tester's cookie key to anything that
// can read their home directory.
if (gnArgs.webdeck_dev_keychain === 'true' && !flag('allow-dev-keychain')) {
  blocker(
    'development keychain compiled in',
    'args.gn has webdeck_dev_keychain = true, so the cookie/password key is a plaintext file in the profile instead of a Keychain item. Rebuild with webdeck_dev_keychain = false, or pass --allow-dev-keychain to package a build that must not leave machines you control.'
  )
}

// The outer app is the only top-level .app that is not a Helper.
const apps = readdirSync(buildDir).filter((n) => n.endsWith('.app') && !n.includes('Helper'))
if (apps.length !== 1) {
  cannotRun(
    apps.length === 0
      ? `no .app in ${buildDir} — build \`chrome\` first`
      : `${apps.length} candidate apps in ${buildDir} (${apps.join(', ')}) — cannot tell which to package`
  )
}
const appName = apps[0]
const product = appName.replace(/\.app$/, '')
const srcApp = join(buildDir, appName)

/** Read an Info.plist key. Returns undefined rather than throwing. */
function plist(path, key) {
  const r = run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path])
  return r.code === 0 ? r.out.trim() : undefined
}
const infoPlist = join(srcApp, 'Contents', 'Info.plist')
if (!existsSync(infoPlist))
  cannotRun(`${appName} has no Contents/Info.plist — the bundle is not built`)

const bundleId = plist(infoPlist, 'CFBundleIdentifier')
const version = plist(infoPlist, 'CFBundleShortVersionString')
const mainExeName = plist(infoPlist, 'CFBundleExecutable')

// The fork's pin. A build older than the pin is the classic way to package
// yesterday's browser and not notice.
let fork = {}
try {
  fork = JSON.parse(readFileSync(join(repoRoot, 'chromium', 'fork.json'), 'utf8'))
} catch (err) {
  warn(
    'fork.json readable',
    `could not read chromium/fork.json (${err.message}) — version not cross-checked`
  )
}

// ── 2. the sanity gate ──────────────────────────────────────────────────────

ok('build directory', buildDir)
ok('app bundle', `${appName} (${product} ${version ?? '?'})`)

if (!bundleId || bundleId === 'org.chromium.Chromium') {
  fail(
    'branding applied',
    `CFBundleIdentifier is ${bundleId ?? 'unset'} — branding.diff is not in this build`
  )
} else {
  ok('branding applied', `CFBundleIdentifier=${bundleId}`)
}

if (fork.base && version && fork.base !== version) {
  fail(
    'build matches the pin',
    `built ${version}, chromium/fork.json pins ${fork.base} — rebuild, or update the pin`
  )
} else if (fork.base) {
  ok('build matches the pin', `${version} == fork.json base`)
}

const exeName = mainExeName ?? product
const mainExe = join(srcApp, 'Contents', 'MacOS', exeName)
if (!existsSync(mainExe)) {
  fail('main executable', `Info.plist names ${exeName}, which does not exist`)
} else {
  ok('main executable', `${exeName} (${(statSync(mainExe).size / 1024).toFixed(0)} KB)`)
}

const fwDir = join(srcApp, 'Contents', 'Frameworks', `${product} Framework.framework`)
const fwCurrent = join(fwDir, 'Versions', 'Current')
const fwBinary = join(fwCurrent, `${product} Framework`)
if (!existsSync(fwBinary)) {
  fail('framework', `no ${product} Framework at ${fwBinary}`)
} else {
  ok('framework', `${(statSync(fwBinary).size / 1024 / 1024).toFixed(1)} MB`)
}

const helpersDir = join(fwCurrent, 'Helpers')
const helperApps = existsSync(helpersDir)
  ? readdirSync(helpersDir).filter((n) => n.endsWith('.app'))
  : []
if (helperApps.length === 0)
  fail('helper apps', 'no helper .app bundles — the renderer/GPU processes are missing')
else ok('helper apps', `${helperApps.length} helpers`)

// macOS kills a process outright — no dialog, no log line, an EXC_CRASH with
// "Namespace TCC" — the first time it touches a privacy-gated service whose
// usage string is missing from Info.plist. Upstream Chromium's template ships
// none (Google adds them in its branded build), and a page asking about
// Bluetooth availability was enough to take a whole session down. The strings
// live in chrome/app/app-Info.plist in the fork's patch set; a bundle without
// every one of them is not fit to package.
const USAGE_STRINGS = [
  'NSBluetoothAlwaysUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSLocationUsageDescription',
  'NSLocalNetworkUsageDescription'
]
const missingUsage = USAGE_STRINGS.filter((key) => !plist(infoPlist, key))
if (missingUsage.length > 0) {
  fail(
    'privacy usage strings',
    `Info.plist lacks ${missingUsage.join(', ')} — macOS terminates the app on first use of that service. Add them to chrome/app/app-Info.plist (fork patch set) and rebuild.`
  )
} else {
  ok('privacy usage strings', `${USAGE_STRINGS.length} present`)
}

const crashpad = join(helpersDir, 'chrome_crashpad_handler')
if (!existsSync(crashpad))
  warn('crash handler', 'chrome_crashpad_handler missing — crashes will not be captured')
else ok('crash handler', 'chrome_crashpad_handler present')

// Resources. A browser that packs without its .pak files starts and renders
// nothing, and the failure looks like a UI bug rather than a packaging one.
const fwResources = join(fwCurrent, 'Resources')
const missingPaks = ['resources.pak', 'chrome_100_percent.pak', 'icudtl.dat'].filter(
  (f) => !existsSync(join(fwResources, f))
)
if (missingPaks.length > 0) fail('resource paks', `missing: ${missingPaks.join(', ')}`)
else ok('resource paks', 'resources.pak, chrome_100_percent.pak, icudtl.dat')

// ── the component build ─────────────────────────────────────────────────────
// Three independent tells, because args.gn can be edited and the build not
// redone. Any one of them is enough.
const looseDylibs = readdirSync(buildDir).filter((n) => n.endsWith('.dylib'))
const fwIsStub = existsSync(fwBinary) && statSync(fwBinary).size < 2 * 1024 * 1024
const isComponent = gnArgs.is_component_build === 'true' || fwIsStub || looseDylibs.length > 50

if (isComponent) {
  const mb = looseDylibs.reduce((n, f) => n + statSync(join(buildDir, f)).size, 0) / 1024 / 1024
  const evidence = [
    gnArgs.is_component_build === 'true' ? 'args.gn says is_component_build = true' : null,
    fwIsStub
      ? `the Framework binary is a ${(statSync(fwBinary).size / 1024).toFixed(0)} KB stub`
      : null,
    `${looseDylibs.length} loose dylibs (${mb.toFixed(0)} MB) beside the app`
  ]
    .filter(Boolean)
    .join('; ')

  if (!flag('allow-component-build')) {
    fail(
      'distributable build config',
      `${evidence}. chrome/installer/mac/signing/README.md: "Signing requires a statically linked build (i.e. is_component_build = false)". Rebuild with is_official_build = true and is_component_build = false, or pass --allow-component-build to make a DEV artifact anyway.`
    )
  } else {
    warn('distributable build config', `COMPONENT BUILD — ${evidence}`)
    blocker(
      'This is a component build',
      'The Framework binary is a stub over ~520 separate dylibs. To make the bundle even launch, this script copies the whole dylib closure into Contents/Frameworks, which quadruples its size and produces exactly the objc duplicate-class warnings you will see on launch. Chromium does not support signing this shape for distribution. Rebuild with is_official_build = true and is_component_build = false.'
    )
  }
} else {
  ok('distributable build config', 'non-component build')
}

if (gnArgs.is_official_build !== 'true') {
  warn(
    'is_official_build',
    'false — dcheck_always_on resolves to true (build/config/dcheck_always_on.gni), so a tester will hit fatal CHECK crashes on conditions shipping Chrome tolerates'
  )
  blocker(
    'DCHECKs are fatal in this build',
    'is_official_build = false turns dcheck_always_on on implicitly. There is no args.gn line to remove; the fix is is_official_build = true.'
  )
} else {
  ok('is_official_build', 'true')
}

// Apple Silicon is the whole target. Intel Macs are deliberately out of scope
// (Windows and Linux come before them), so an arm64-only build is correct here
// and saying otherwise on every run trains people to ignore the warnings.
ok('target_cpu', `${gnArgs.target_cpu ?? 'arm64'} — Apple Silicon only, by design`)

// ── webdeck-core ────────────────────────────────────────────────────────────
// The fork spawns an executable called webdeck-core out of base::DIR_MODULE.
// Today that is a shell script pointing at Homebrew's node and a checkout of
// this repo. Both paths are absolute and neither exists on a tester's machine.
const coreInBundle = join(srcApp, 'Contents', 'MacOS', 'webdeck-core')
if (!existsSync(coreInBundle)) {
  warn('webdeck-core', 'absent from the bundle — chrome://webdeck will not connect to anything')
  blocker(
    'webdeck-core is not in the bundle',
    'chrome://webdeck spawns it from base::DIR_MODULE. Without it the browser runs but the product does not.'
  )
} else {
  const head = readFileSync(coreInBundle, 'utf8').slice(0, 512)
  if (head.startsWith('#!')) {
    const paths = [...head.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1])
    const outside = paths.filter((p) => !p.startsWith(srcApp))
    warn('webdeck-core', `a shell script referencing ${outside.length} path(s) outside the bundle`)
    blocker(
      'webdeck-core is a shell script with absolute paths outside the app',
      `It execs ${outside.join(' and ') || '(unparsed paths)'}. On any other machine those do not exist, so chrome://webdeck cannot start its backend. codesign also refuses to seal the app until this file is signed in its own right, and a script's signature lives in extended attributes rather than in the file — it survives a HFS+ dmg and does not survive a plain zip or most upload paths. It must become a real Mach-O executable inside the bundle before anything is notarized.`
    )
  } else {
    ok('webdeck-core', 'present and not a script')
  }
}

const failed = checks.filter((c) => c.status === 'fail')

// ── reporting ───────────────────────────────────────────────────────────────

const SYMBOL = { ok: '✓', warn: '!', fail: '✗' }

function realSigningInstructions() {
  if (notaryProfile) return ''
  return [
    'To make an installer that opens with no warning:',
    '',
    '  npm run release:preflight    # which Apple credentials are missing, and how',
    '                               # to get each one',
    `  npm run release:dmg -- --build-dir "${buildDir}" --out "${outDir}"`,
    '',
    '  That is this script with --identity auto --notary-profile webdeck-notary:',
    '  it signs with the hardened runtime and a secure timestamp, notarizes and',
    '  staples the app, wraps it in a dmg, signs and notarizes that too, and',
    '  proves the result with spctl and stapler validate.',
    '',
    '  It needs a "Developer ID Application" certificate. Nothing else works:',
    '  Apple notarizes no other kind, and a certificate with no Team ID cannot',
    '  even launch under the hardened runtime. Measured on macOS 26.5.1 —',
    '  ad-hoc or self-signed + `runtime` dies with "mapping process and mapped',
    '  file (non-platform) have different Team IDs", and + `restrict` dies with',
    '  "security policy does not allow @ path expansion".',
    '',
    '  Full runbook: chromium/RELEASING.md'
  ].join('\n')
}

function report(result, exitCode) {
  if (asJson) {
    console.log(JSON.stringify({ ...result, checks, blockers }, null, 2))
    process.exit(exitCode)
  }
  for (const c of checks)
    console.log(`${SYMBOL[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  if (result.artifacts?.length) {
    console.log('')
    for (const a of result.artifacts) console.log(`→ ${a.path}${a.size ? ` (${a.size})` : ''}`)
  }
  if (blockers.length > 0) {
    console.log(
      `\nNOT DISTRIBUTABLE — ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}:`
    )
    for (const b of blockers)
      console.log(`\n  • ${b.title}\n    ${b.detail.replace(/\n/g, '\n    ')}`)
  }
  console.log('')
  console.log(realSigningInstructions())
  console.log('')
  console.log(result.summary)
  process.exit(exitCode)
}

if (failed.length > 0) {
  report(
    {
      status: 'unfit',
      summary: `Refusing to package: ${failed.length} sanity check${failed.length === 1 ? '' : 's'} failed. Nothing was written.`
    },
    1
  )
}

// ── 3. stage ────────────────────────────────────────────────────────────────

const label = isComponent
  ? `${version}-${gnArgs.target_cpu ?? 'arm64'}-COMPONENT-DEV`
  : `${version}-${gnArgs.target_cpu ?? 'arm64'}`
const stageRoot = join(outDir, 'stage')
const stagedApp = join(stageRoot, appName)
const dmgPath = join(outDir, `${product.replace(/ /g, '-')}-${label}.dmg`)

/** Is this file a Mach-O image? Cheap: read the magic. */
function isMachO(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(4)
    if (readSync(fd, buf, 0, 4, 0) < 4) return false
    const magic = buf.readUInt32BE(0)
    // MH_MAGIC_64 / MH_CIGAM_64 / FAT_MAGIC / FAT_CIGAM
    return (
      magic === 0xfeedfacf || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca
    )
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** `otool -L` over many files at once. Returns Map<path, dependency[]>. */
function machODeps(paths) {
  const deps = new Map()
  for (let i = 0; i < paths.length; i += 64) {
    const chunk = paths.slice(i, i + 64)
    const out = run('/usr/bin/otool', ['-L', ...chunk]).out
    let current = null
    for (const line of out.split('\n')) {
      if (!line.startsWith('\t')) {
        const m = /^(.*):$/.exec(line)
        if (m && !m[1].startsWith('Archive')) {
          current = m[1]
          deps.set(current, [])
        }
        continue
      }
      const dep = line.trim().replace(/ \(compatibility version.*$/, '')
      if (current) deps.get(current).push(dep)
    }
  }
  return deps
}

/** Every Mach-O file inside a directory tree. */
function machOsUnder(dir) {
  const found = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && isMachO(p)) found.push(p)
    }
  }
  walk(dir)
  return found
}

let dmgSize = null
let mounted = null
try {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })
  cpSync(srcApp, stagedApp, { recursive: true, verbatimSymlinks: true })
  ok('staged the app', stagedApp)

  const stagedFrameworks = join(stagedApp, 'Contents', 'Frameworks')

  // For a component build the bundle is not self-contained: its rpaths reach
  // out to the build directory. Copying the closure into Contents/Frameworks
  // makes it whole — that path is on every rpath list in the bundle (the main
  // executable's @executable_path/../Frameworks, the framework's
  // @loader_path/../../.., the helpers' @executable_path/../../../../../../..).
  if (isComponent) {
    const available = new Map(looseDylibs.map((n) => [n, join(buildDir, n)]))
    const copied = new Set()
    let frontier = machOsUnder(stagedApp)
    while (frontier.length > 0) {
      const next = []
      for (const [, deps] of machODeps(frontier)) {
        for (const dep of deps) {
          if (!dep.startsWith('@rpath/')) continue
          const name = dep.slice('@rpath/'.length)
          if (name.includes('/')) continue // the framework itself, already inside
          if (copied.has(name) || !available.has(name)) continue
          const dest = join(stagedFrameworks, name)
          cpSync(available.get(name), dest)
          copied.add(name)
          next.push(dest)
        }
      }
      frontier = next
    }
    ok(
      'copied the dylib closure',
      `${copied.size} of ${looseDylibs.length} dylibs into Contents/Frameworks`
    )
  }

  // Whatever the config, prove the bundle resolves against itself. This is the
  // check that catches a staging bug: a bundle missing one dylib passes every
  // other check here and dies in dyld on the tester's machine.
  const insideNames = new Set([
    ...readdirSync(stagedFrameworks).filter((n) => n.endsWith('.dylib')),
    ...(existsSync(join(fwCurrent, 'Libraries'))
      ? readdirSync(
          join(
            stagedApp,
            'Contents',
            'Frameworks',
            `${product} Framework.framework`,
            'Versions',
            'Current',
            'Libraries'
          )
        ).filter((n) => n.endsWith('.dylib'))
      : [])
  ])
  const unresolved = new Set()
  for (const [file, deps] of machODeps(machOsUnder(stagedApp))) {
    for (const dep of deps) {
      if (!dep.startsWith('@rpath/')) continue
      const name = dep.slice('@rpath/'.length)
      if (name.includes('/')) continue
      if (!insideNames.has(name)) unresolved.add(`${name} (needed by ${basename(file)})`)
    }
  }
  if (unresolved.size > 0) {
    fail(
      'bundle is self-contained',
      `${unresolved.size} unresolved @rpath dependencies: ${[...unresolved].slice(0, 5).join(', ')}`
    )
    report(
      {
        status: 'failed',
        summary: 'The staged bundle is not self-contained — it would not launch off this machine.'
      },
      1
    )
  }
  ok('bundle is self-contained', 'every @rpath dependency resolves inside the app')

  // ── 4. ad-hoc sign, inside-out, the order chrome/installer/mac uses ────────

  // The entitlements the real signing run applies. Found relative to the build
  // dir so this works against any checkout.
  let checkout = buildDir
  while (
    checkout !== '/' &&
    !existsSync(join(checkout, 'chrome', 'app', 'app-entitlements.plist'))
  ) {
    checkout = dirname(checkout)
  }
  const entitlementsDir = checkout === '/' ? null : join(checkout, 'chrome', 'app')
  if (!entitlementsDir)
    warn(
      'entitlements',
      'chrome/app/app-entitlements.plist not found — signing without entitlements'
    )

  // Which certificate seals this build. Resolved to a SHA-1 hash rather than a
  // name so a keychain holding two certificates with the same common name can
  // never sign with the wrong one.
  let signIdentity = '-'
  let identityName = 'ad-hoc'
  if (identityArg !== '-') {
    // Two lists, because they answer different questions. `-v` is the valid
    // ones: a Developer ID must be there, since a certificate that does not
    // validate cannot notarize. The full list also holds identities macOS does
    // not trust — a self-signed one made by dev-signing-identity.mjs is always
    // untrusted, and codesign signs with it happily. That is the point of it:
    // it gives local test builds the SAME signature every time, so the
    // Keychain stops asking for the login password on every rebuild.
    const parse = (out) =>
      [...out.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+?)"/gm)].map((m) => ({
        hash: m[1],
        name: m[2]
      }))
    const valid = parse(run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']).out)
    const all = parse(run('/usr/bin/security', ['find-identity', '-p', 'codesigning']).out)
    const rows = identityArg === 'auto' ? valid : all
    const devIds = valid.filter((r) => r.name.startsWith('Developer ID Application:'))
    const candidates =
      identityArg === 'auto'
        ? devIds
        : rows.filter(
            (r) => r.hash === identityArg || r.name === identityArg || r.name.includes(identityArg)
          )
    // The full list repeats each identity under "Matching" and "Valid only".
    const matches = [...new Map(candidates.map((r) => [r.hash, r])).values()]
    if (matches.length === 0) {
      cannotRun(
        identityArg === 'auto'
          ? `no "Developer ID Application" certificate in the login keychain — the kind Apple notarizes, and the only kind a release can ship with. (${rows.length === 0 ? 'The keychain holds no code-signing identity at all.' : `The keychain's ${rows.length === 1 ? 'one other identity is' : `${rows.length} other identities are`} not Developer ID and ${rows.length === 1 ? 'is' : 'are'} not used by WebDeck.`}) Enrol in the Apple Developer Program, then create the certificate in Xcode (Settings → Accounts → Manage Certificates → + → Developer ID Application). For a build that stays on this Mac: npm run dev:signing-identity, then --identity "Arcwel WebDeck Dev" --allow-dev-keychain.`
          : `no code-signing identity matching "${identityArg}". Available: ${rows.map((r) => r.name).join(', ') || 'none'}.`
      )
    }
    if (matches.length > 1) {
      cannotRun(
        `"${identityArg}" matches ${matches.length} identities (${matches.map((r) => r.name).join(', ')}) — name one exactly, or pass its SHA-1.`
      )
    }
    signIdentity = matches[0].hash
    identityName = matches[0].name
    // A self-signed or Apple Development certificate signs fine and notarizes
    // never. Saying so here costs a second; finding out costs an upload.
    if (!identityName.startsWith('Developer ID Application:')) {
      // Not a warning to be read later: the hardened runtime is applied only to
      // Developer ID because a certificate with no Team ID produces a bundle
      // that will not launch at all, and notarization would reject it anyway.
      if (notaryProfile) {
        cannotRun(
          `${identityName} is not a "Developer ID Application" certificate, and Apple notarizes no other kind. Run \`npm run release:preflight\` for how to get one.`
        )
      }
      warn(
        'certificate type',
        `${identityName} is not a "Developer ID Application" certificate. It signs, but it carries no Team ID, so this build is signed WITHOUT the hardened runtime — it is no more distributable than an ad-hoc one.`
      )
    }
  }
  const realIdentity = signIdentity !== '-'
  // The hardened runtime is a precondition for notarization, and a secure
  // timestamp is what keeps the signature valid after the certificate expires.
  // Both are applied only for a Developer ID certificate: under `runtime`, dyld
  // validates that the bundle's own libraries share the main executable's Team
  // ID, and a certificate without one leaves nothing to match — the app dies on
  // launch with "mapping process and mapped file (non-platform) have different
  // Team IDs". Measured, not assumed.
  const hardened = realIdentity && identityName.startsWith('Developer ID Application:')

  /** codesign, in batches. `options` is a codesign --options string. */
  function sign(paths, { options, entitlements } = {}) {
    const base = ['--force', '--sign', signIdentity]
    if (hardened) base.push('--timestamp', '--options', options ? `runtime,${options}` : 'runtime')
    else if (options) base.push('--options', options)
    if (entitlements && entitlementsDir)
      base.push('--entitlements', join(entitlementsDir, entitlements))
    for (let i = 0; i < paths.length; i += 40) {
      must(
        '/usr/bin/codesign',
        [...base, ...paths.slice(i, i + 40)],
        `codesign ${basename(paths[i])}`
      )
    }
  }

  /** Mach-O magic, so a data file is never handed to codesign as if it were code. */
  function isMachO(file) {
    try {
      const fd = openSync(file, 'r')
      const buf = Buffer.alloc(4)
      readSync(fd, buf, 0, 4, 0)
      closeSync(fd)
      const magic = buf.readUInt32BE(0)
      // feedface / feedfacf (thin, BE-read), cffaedfe / cefaedfe (LE), cafebabe (fat)
      return (
        magic === 0xfeedface ||
        magic === 0xfeedfacf ||
        magic === 0xcffaedfe ||
        magic === 0xcefaedfe ||
        magic === 0xcafebabe
      )
    } catch {
      return false
    }
  }

  const stagedFw = join(stagedApp, 'Contents', 'Frameworks', `${product} Framework.framework`)
  const stagedCurrent = join(stagedFw, 'Versions', 'Current')
  const stagedHelpers = join(stagedCurrent, 'Helpers')

  // 1. the loose dylibs, 2. the framework's own Libraries
  const flatDylibs = readdirSync(stagedFrameworks)
    .filter((n) => n.endsWith('.dylib'))
    .map((n) => join(stagedFrameworks, n))
  if (flatDylibs.length > 0) sign(flatDylibs)
  const fwLibs = existsSync(join(stagedCurrent, 'Libraries'))
    ? readdirSync(join(stagedCurrent, 'Libraries'))
        .filter((n) => n.endsWith('.dylib'))
        .map((n) => join(stagedCurrent, 'Libraries', n))
    : []
  if (fwLibs.length > 0) sign(fwLibs)

  // 3. the helpers. Chromium gives the renderer and GPU helpers their own,
  //    narrower entitlements; the rest inherit the app's.
  for (const entry of readdirSync(stagedHelpers)) {
    const p = join(stagedHelpers, entry)
    const ent = /Renderer/.test(entry)
      ? 'helper-renderer-entitlements.plist'
      : /GPU/.test(entry)
        ? 'helper-gpu-entitlements.plist'
        : undefined
    // `kill` only: ad-hoc code has no Team ID, so `runtime`/`library` make dyld
    // refuse the bundle's own libraries and `restrict` bans @rpath expansion.
    sign([p], { options: 'kill', entitlements: ent })
  }

  // 4. the framework itself (a dylib — codesign --options flags are meaningless)
  sign([stagedFw])

  // 5. webdeck-core and everything Mach-O inside its runtime. The runtime is a
  //    plain directory, not a bundle, so codesign will not reach the native
  //    files (node-pty's pty.node and spawn-helper) on its own — each has to be
  //    sealed in its own right, deepest first, or --verify --deep --strict
  //    rejects the app. This is also what makes the whole thing notarizable:
  //    every executable carries the same signature.
  const machoInRuntime = []
  const runtimeRoot = join(stagedApp, 'Contents', 'Resources', 'webdeck-core-runtime')
  if (existsSync(runtimeRoot)) {
    const stack = [runtimeRoot]
    while (stack.length) {
      const dir = stack.pop()
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (isMachO(full)) machoInRuntime.push(full)
      }
    }
  }
  // Deepest paths first, so a containing item is never sealed before its
  // contents.
  machoInRuntime.sort((a, b) => b.length - a.length)
  if (machoInRuntime.length > 0) sign(machoInRuntime, { options: 'kill' })

  // Then anything else loose in Contents/MacOS (the SEA core included). The
  // shell shim used to block signing here; a real Mach-O signs cleanly.
  const extraMacOS = readdirSync(join(stagedApp, 'Contents', 'MacOS'))
    .filter((n) => n !== mainExeName && n !== 'webdeck-core-runtime')
    .map((n) => join(stagedApp, 'Contents', 'MacOS', n))
  if (extraMacOS.length > 0) sign(extraMacOS, { options: 'kill' })

  // 6. the app
  sign([stagedApp], { options: 'kill', entitlements: 'app-entitlements.plist' })

  const dv = run('/usr/bin/codesign', ['-dv', stagedApp])
  const dvText = (dv.err || dv.out).split('\n')
  const pick = (k) => dvText.find((l) => l.startsWith(k))?.trim() ?? ''
  ok(
    realIdentity ? `signed · ${identityName}` : 'ad-hoc signed',
    `${pick('Identifier=')} · ${pick('CodeDirectory')?.match(/flags=\S+/)?.[0] ?? ''} · ${pick('Sealed Resources')}`
  )

  const verify = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
  if (verify.code !== 0) {
    fail('signature verifies', (verify.err || verify.out).trim().split('\n').slice(-2).join(' / '))
    report(
      { status: 'failed', summary: 'The ad-hoc signature does not verify — packaging stopped.' },
      1
    )
  }
  ok('signature verifies', 'codesign --verify --deep --strict')

  // ── 4b. notarize the app ──────────────────────────────────────────────────

  // The app is notarized and stapled BEFORE it is copied into the disk image,
  // so the copy a tester drags to Applications carries its own ticket. Notarize
  // only the dmg and that copy has none: Gatekeeper then has to ask Apple over
  // the network on first launch, and a tester who is offline — or behind a
  // network that blocks it — gets the warning this whole exercise removes.
  /** notarytool, with a timeout long enough for Apple's queue. */
  function notarize(what, path) {
    const submit = run(
      '/usr/bin/xcrun',
      [
        'notarytool',
        'submit',
        path,
        '--keychain-profile',
        notaryProfile,
        '--wait',
        '--timeout',
        '30m'
      ],
      { timeout: 35 * 60 * 1000 }
    )
    const text = `${submit.out}\n${submit.err}`
    const id = /id: ([0-9a-f-]{36})/.exec(text)?.[1]
    if (submit.code !== 0 || !/status: Accepted/.test(text)) {
      const why = /status: (\w+)/.exec(text)?.[1] ?? 'no status returned'
      fail(
        `notarized: ${what}`,
        `${why}. ${id ? `Read Apple's reasons with: xcrun notarytool log ${id} --keychain-profile ${notaryProfile}` : text.trim().split('\n').slice(-2).join(' / ')}`
      )
      return false
    }
    // Stapling attaches the ticket to the artifact itself, which is what makes
    // the first launch work with no network.
    const staple = run('/usr/bin/xcrun', ['stapler', 'staple', path], { timeout: 5 * 60 * 1000 })
    if (staple.code !== 0) {
      fail(`stapled: ${what}`, (staple.err || staple.out).trim().split('\n').slice(-1)[0])
      return false
    }
    ok(`notarized and stapled: ${what}`, `submission ${id ?? '?'}`)
    return true
  }

  if (notaryProfile) {
    if (run('/usr/bin/which', ['xcrun']).code !== 0) {
      fail('notarization', 'xcrun not found — install Xcode or the command line tools')
    } else {
      // notarytool takes an archive, not a bundle. ditto keeps the symlinks and
      // the extended attributes the signature lives in; `zip` does not.
      const zipPath = join(outDir, `${product}-notarize.zip`)
      must(
        '/usr/bin/ditto',
        ['-c', '-k', '--keepParent', stagedApp, zipPath],
        'ditto (archive for notarization)'
      )
      notarize('the app', zipPath)
      rmSync(zipPath, { force: true })
    }
  }

  // ── 4b. the release archive ───────────────────────────────────────────────
  // What "Update now" in the app downloads: the stapled app as a zip, named by
  // WebDeck's own version (the dmg carries Chromium's), with SHA256SUMS beside
  // it. Both go up as release assets. ditto keeps the extended attributes the
  // signature lives in; plain zip does not.
  {
    const pkgVersion = JSON.parse(
      readFileSync(join(repoRoot, 'app', 'package.json'), 'utf8')
    ).version
    const releaseZip = join(
      outDir,
      `Arcwel-WebDeck-${pkgVersion}-${gnArgs.target_cpu ?? 'arm64'}.zip`
    )
    rmSync(releaseZip, { force: true })
    // The staged tree can carry a quarantine flag from wherever the build
    // was copied. Sequestered into the zip it would come back out on every
    // unpack and make Gatekeeper refuse a build the updater already verified;
    // a browser download gets its own flag on the zip regardless.
    run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', stagedApp])
    must(
      '/usr/bin/ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', stagedApp, releaseZip],
      'ditto (release archive)'
    )
    const digest = createHash('sha256').update(readFileSync(releaseZip)).digest('hex')
    writeFileSync(join(outDir, 'SHA256SUMS'), `${digest}  ${basename(releaseZip)}\n`)
    ok(
      'release archive',
      `${basename(releaseZip)} (${(statSync(releaseZip).size / 1024 / 1024).toFixed(0)} MB) + SHA256SUMS`
    )
  }

  // ── 5. the disk image ─────────────────────────────────────────────────────

  if (flag('skip-dmg')) {
    // Without the dmg there is no mount-and-launch check, and signing is
    // exactly where a bundle stops launching. --version links the framework and
    // every dylib the browser needs at startup, which is what a bad signature
    // breaks.
    const staticLaunch = run(join(stagedApp, 'Contents', 'MacOS', mainExeName), ['--version'], {
      timeout: 120000
    })
    if (staticLaunch.code !== 0 || !staticLaunch.out.includes(version ?? '')) {
      fail(
        'the signed app runs',
        (staticLaunch.err || '')
          .split('\n')
          .filter((l) => !l.startsWith('objc['))
          .slice(0, 1)
          .join(' ')
          .slice(0, 200) || `exit ${staticLaunch.code}`
      )
    } else {
      ok('the signed app runs', staticLaunch.out.trim())
    }
    ok('disk image', 'skipped (--skip-dmg)')
    report(
      {
        status: 'staged',
        artifacts: [
          {
            path: stagedApp,
            size: `${Number(run('/usr/bin/du', ['-sm', stagedApp]).out.split('\t')[0]) || 0} MB`
          }
        ],
        summary:
          blockers.length > 0
            ? `Staged and signed (${identityName}). NOT distributable — see the blockers above.`
            : `Staged and signed (${identityName}).`
      },
      0
    )
  }

  // chrome/installer/mac/pkg-dmg (a checked-in perl wrapper around hdiutil) is
  // what the real pipeline uses, with --format ULMO and a branded .DS_Store.
  // Neither the background art nor the layout exists for an unbranded build, so
  // this does the same thing hdiutil does underneath: a drag-install volume with
  // the app and a symlink to /Applications.
  symlinkSync('/Applications', join(stageRoot, 'Applications'))
  must(
    '/usr/bin/hdiutil',
    [
      'create',
      '-quiet',
      '-srcfolder',
      stageRoot,
      '-volname',
      product,
      '-fs',
      'HFS+',
      '-format',
      dmgFormat,
      '-ov',
      dmgPath
    ],
    'hdiutil create'
  )
  dmgSize = `${(statSync(dmgPath).size / 1024 / 1024).toFixed(0)} MB`
  ok('disk image', `${basename(dmgPath)} (${dmgSize}, ${dmgFormat})`)

  // The disk image is code to Gatekeeper too: signing it is what stops the
  // download itself being flagged, and notarizing it is what lets the user
  // mount it without the "downloaded from the internet" interrogation.
  if (realIdentity) {
    must(
      '/usr/bin/codesign',
      ['--force', '--sign', signIdentity, ...(hardened ? ['--timestamp'] : []), dmgPath],
      'codesign (disk image)'
    )
    ok('disk image signed', identityName)
    if (notaryProfile) notarize('the disk image', dmgPath)
  }

  // ── 6. prove it ───────────────────────────────────────────────────────────

  if (!flag('no-verify')) {
    const attach = must(
      '/usr/bin/hdiutil',
      ['attach', '-nobrowse', '-readonly', '-mountrandom', '/private/tmp', dmgPath],
      'hdiutil attach'
    )
    mounted = attach.trim().split('\n').pop().split('\t').pop().trim()
    const mountedApp = join(mounted, appName)
    if (!existsSync(mountedApp)) throw new Error(`${appName} is not on the mounted volume`)

    const mv = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp])
    if (mv.code !== 0)
      fail('signature survives the dmg', (mv.err || mv.out).trim().split('\n').slice(-1)[0])
    else ok('signature survives the dmg', 'verifies while mounted read-only')

    // --version is enough: it links the whole framework and every dylib the
    // browser needs at startup, which is exactly what a broken bundle fails at.
    const launch = run(join(mountedApp, 'Contents', 'MacOS', mainExeName), ['--version'], {
      timeout: 120000
    })
    const printed = launch.out.trim()
    if (launch.code !== 0 || !printed.includes(version)) {
      const why = (launch.err || '')
        .split('\n')
        .filter((l) => !l.startsWith('objc['))
        .slice(0, 3)
        .join(' / ')
      fail('the app in the dmg runs', `exit ${launch.code}${why ? ` — ${why}` : ''}`)
    } else {
      ok('the app in the dmg runs', printed)
    }
    const dupes = (launch.err || '')
      .split('\n')
      .filter((l) => l.includes('is implemented in both')).length
    if (dupes > 0) {
      warn(
        'objc duplicate classes',
        `${dupes} — every dylib in the closure carries its own copy. A component-build artefact; it does not happen in a static build.`
      )
    }

    // What Gatekeeper will actually say when a tester double-clicks. This is
    // the check the whole distribution path exists to pass, so with a real
    // identity it is a verdict, not a note.
    const spctl = run('/usr/sbin/spctl', ['-a', '-vvv', '-t', 'exec', mountedApp])
    const verdict = (spctl.err || spctl.out).trim().split('\n').join(' ').slice(0, 160)
    if (notaryProfile) {
      if (/accepted/.test(verdict) && /Notarized Developer ID/.test(verdict)) {
        ok('Gatekeeper accepts it', 'source=Notarized Developer ID — opens with no warning')
      } else {
        fail('Gatekeeper accepts it', `spctl: ${verdict}`)
      }
      // The stapled ticket is what makes that true offline as well.
      const stapled = run('/usr/bin/xcrun', ['stapler', 'validate', mountedApp])
      if (stapled.code === 0) ok('ticket travels with the app', 'stapler validate passed')
      else
        fail(
          'ticket travels with the app',
          'the app on the volume has no stapled ticket — a tester with no network will still be asked'
        )
    } else {
      warn(
        'Gatekeeper',
        `spctl: ${verdict} — expected: ${realIdentity ? 'signed but not notarized' : 'ad-hoc is not notarized'}. macOS 15 and later removed the Control-click bypass, so a tester must approve this in System Settings → Privacy & Security. Pass --identity and --notary-profile for an install with no warning.`
      )
    }
  }
} catch (err) {
  fail('packaging', err.message)
  if (mounted) run('/usr/bin/hdiutil', ['detach', mounted, '-quiet', '-force'])
  report({ status: 'failed', summary: `Packaging failed: ${err.message}` }, 1)
} finally {
  if (mounted) run('/usr/bin/hdiutil', ['detach', mounted, '-quiet'])
}

if (!flag('keep-stage')) rmSync(stageRoot, { recursive: true, force: true })

const late = checks.filter((c) => c.status === 'fail')
report(
  {
    status: late.length > 0 ? 'failed' : 'packaged',
    artifacts: [{ path: dmgPath, size: dmgSize }],
    summary:
      late.length > 0
        ? 'The dmg was written but a check failed — read the ✗ lines.'
        : blockers.length > 0
          ? `Packaged. This dmg is for testing on machines you control, NOT for distribution — ${blockers.length} blocker${blockers.length === 1 ? '' : 's'} above.`
          : notaryProfile
            ? 'Packaged, notarized and stapled. This installs like any other Mac app.'
            : 'Packaged and verified. Not notarized: testers will meet Gatekeeper.'
  },
  late.length > 0 ? 1 : 0
)
