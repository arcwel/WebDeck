#!/usr/bin/env node
// Builds `webdeck-core` — the standalone IDE/agent service the Chromium fork
// spawns — as a signable, self-contained macOS executable.
//
// Output (out/core by default):
//
//   webdeck-core                     a Mach-O Single Executable Application
//   webdeck-core-runtime/            the parts that cannot live inside it
//     node_modules/node-pty/…          native addon (pty.node, spawn-helper)
//     node_modules/reveal.js/…         data files slides.ts require.resolve()s
//     resources/…                      pty host, vendored js-debug adapter
//   webdeck-core.cjs                 the intermediate bundle (kept for debugging)
//
// WHY A SINGLE EXECUTABLE APPLICATION, and not the alternatives:
//
//   * A shell script running the user's Node (what shipped before) cannot be
//     notarized. Every executable inside a signed bundle must be sealed and
//     carry the same Team ID, and Chrome signs with `library` validation, which
//     forbids loading anything else. It also assumed a Homebrew install.
//   * `node --build-snapshot` produces a *blob*, not an executable. It still
//     needs a `node` to run it, so it solves nothing on its own. (SEA can embed
//     a snapshot; see useSnapshot below for why we don't.)
//   * Shipping a `node` binary beside a loose .cjs works, but leaves our code
//     outside the code signature — sealed as a bundle resource at best — and
//     needs a second Mach-O launcher because `node` has no way to be invoked as
//     `webdeck-core`. SEA puts the JS *inside* the signed binary.
//   * Bun/Deno `compile` would swap the runtime under a service written against
//     Node APIs, for no signing benefit.
//
// The base runtime is fetched from nodejs.org rather than taken from the build
// machine — see scripts/fetch-node-runtime.mjs for why that is not optional.
//
// Usage: node scripts/build-core.mjs [--outdir path] [--no-sea] [--json]
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  readdirSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { ensureNodeRuntime, nodeRuntimeVersion } from './fetch-node-runtime.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : undefined
}

const outdir = flag('outdir') ? resolve(flag('outdir')) : join(root, 'out', 'core')
const bundleFile = join(outdir, 'webdeck-core.cjs')
const exeFile = join(outdir, 'webdeck-core')
const runtimeDir = join(outdir, 'webdeck-core-runtime')
const wantSea = !process.argv.includes('--no-sea')
const asJson = process.argv.includes('--json')

/**
 * node-pty is the one dependency that cannot go inside the executable: it is a
 * native addon, and a `.node` file has to exist on disk for dlopen. It ships in
 * the runtime directory instead and is signed as its own part.
 *
 * `electron` is listed so a build that somehow reached Electron fails loudly
 * here rather than at runtime on the fork; bufferutil/utf-8-validate are ws's
 * optional native speedups, which ws already require()s inside a try/catch.
 */
const EXTERNAL = ['electron', 'node-pty', 'bufferutil', 'utf-8-validate']

/**
 * Packages the core resolves from disk at runtime rather than importing, so
 * esbuild cannot inline them. reveal.js is load-bearing: slides.ts calls
 * `require.resolve('reveal.js')` at module scope, so the core does not boot at
 * all without it.
 */
const RUNTIME_PACKAGES = [
  {
    name: 'node-pty',
    include: ['package.json', 'lib', `prebuilds/${process.platform}-${process.arch}`]
  },
  { name: 'reveal.js', include: ['package.json', 'dist', 'plugin'] },
  // The TypeScript language server (lsp.ts spawns lib/cli.mjs) and its typescript
  // peer (which provides tsserver). typescript-language-server declares no npm
  // dependencies — it pre-bundles them into lib/ — so these two packages are the
  // whole closure. Without them, editor IntelliSense is silently absent on the
  // fork (resolveServer returns null → "not installed").
  { name: 'typescript-language-server', include: ['package.json', 'lib'] },
  { name: 'typescript', include: ['package.json', 'lib', 'bin'] },
  // The Pyright language server (lsp.ts spawns pyright/langserver.index.js). Like
  // typescript-language-server, pyright pre-bundles its whole dependency tree into
  // dist/ — its package.json declares no runtime `dependencies`, only an optional
  // `fsevents` (macOS file-watching speedup that vscode-languageserver already
  // require()s inside a try/catch) — so this one package is the complete closure.
  // dist/ carries the bundled JS *and* typeshed-fallback (the Python stdlib type
  // stubs pyright resolves via global.__rootDirectory); langserver.index.js is the
  // stdio entry. Without these, Python IntelliSense is silently absent on the fork
  // (resolveServer returns null -> "not installed").
  { name: 'pyright', include: ['package.json', 'langserver.index.js', 'dist'] }
]

/**
 * Prologue injected ahead of the bundle inside the SEA.
 *
 * Two jobs, both of which have to happen before any bundled module runs:
 *
 * 1. Give the bundle a real `require`. Inside a SEA, the ambient `require`
 *    resolves builtins only — `require('node-pty')` and
 *    `require.resolve('reveal.js')` both throw. Node's documented remedy is to
 *    rebind it with createRequire; we root it in the runtime directory so bare
 *    specifiers resolve there instead of wherever the executable happens to sit.
 *
 * 2. Act as a plain `node` when asked. Several call sites spawn
 *    `process.execPath` with a script path (the language server, the debug
 *    adapter). Under a SEA that would re-launch the core. Honouring
 *    ELECTRON_RUN_AS_NODE — which those call sites already set, because they
 *    were written for Electron — makes the executable behave exactly like the
 *    `node` it was built from, so no call site has to change.
 */
const SEA_PROLOGUE = `
const { createRequire } = require('node:module')
const __wdPath = require('node:path')
const __wdRuntime =
  process.env.WEBDECK_CORE_RUNTIME ||
  __wdPath.join(__wdPath.dirname(process.execPath), 'webdeck-core-runtime')
process.env.WEBDECK_CORE_RUNTIME = __wdRuntime
require = createRequire(__wdPath.join(__wdRuntime, 'noop.cjs'))

if (process.env.ELECTRON_RUN_AS_NODE === '1' && process.argv.length > 2) {
  // Node sets process.argv[1] to the SEA executable path itself (NOT the passed
  // script), so a caller that spawns \`execPath [entry, ...args]\` — the language
  // server and debug adapter both do — lands \`entry\` at argv[2]. Splicing out
  // the duplicated exe path at [1] restores a normal \`node <script> <args>\`
  // layout the spawned tool expects; using argv[1] verbatim (as before) required
  // the Mach-O binary and threw "Invalid or unexpected token", disabling LSP/DAP.
  process.argv.splice(1, 1)
  const script = __wdPath.resolve(process.argv[1])
  process.argv[1] = script
  delete process.env.ELECTRON_RUN_AS_NODE
  if (/\\.mjs$/.test(script)) {
    import(require('node:url').pathToFileURL(script).href)
  } else {
    require(script)
  }
} else {
`
const SEA_EPILOGUE = '\n}\n'

/* ---------- 1. bundle ---------- */

const result = await build({
  entryPoints: [join(root, 'src', 'core', 'main.ts')],
  outfile: bundleFile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CJS, not ESM: the external deps (node-pty) are CJS with subpath entries
  // that Node's ESM resolver rejects, a Node service gains nothing from ESM
  // output, and the SEA `require` rebinding above only works in a CJS scope.
  format: 'cjs',
  sourcemap: true,
  // Sources written for ESM (electron-vite's format) use `import.meta.url` to
  // resolve bundled tools; in CJS output that is undefined, so map it to the
  // equivalent file URL of the bundle itself.
  define: {
    'import.meta.url': '__wdModuleUrl',
    // The core's own version, from package.json — what the release checker
    // compares against and what Settings → About shows.
    __WEBDECK_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    ),
    // The Chromium base (chromium/fork.json) — the release checker compares a
    // release's base against it to flag upstream security fixes.
    __WEBDECK_CHROMIUM__: JSON.stringify(
      JSON.parse(readFileSync(join(root, '..', 'chromium', 'fork.json'), 'utf8')).base ?? ''
    ),
    // The public key update manifests must verify against. Absent (a fresh
    // clone before --genkey) means the core downloads no release in-app.
    __WEBDECK_UPDATE_PUBKEY__: JSON.stringify(
      existsSync(join(root, 'release', 'update-pubkey.pem'))
        ? readFileSync(join(root, 'release', 'update-pubkey.pem'), 'utf8')
        : ''
    )
  },
  banner: {
    js: "const __wdModuleUrl = require('node:url').pathToFileURL(__filename).href;"
  },
  external: EXTERNAL,
  alias: {
    '@shared': join(root, 'src', 'shared')
  },
  logLevel: asJson ? 'silent' : 'info',
  metafile: true
})

// A build that pulled in Electron would be broken on the fork — catch it here
// rather than at runtime on someone's machine.
const inputs = Object.keys(result.metafile.inputs)
const electronish = inputs.filter((f) => /(^|\/)electron(\/|$)|electron\.ts$/.test(f))
if (electronish.length > 0) {
  console.error('webdeck-core bundle pulled in Electron:', electronish)
  process.exit(1)
}

if (existsSync(bundleFile)) chmodSync(bundleFile, 0o755)

if (!wantSea) {
  if (!asJson) {
    console.log(`webdeck-core -> ${bundleFile} (${inputs.length} modules, Electron-free)`)
  }
  process.exit(0)
}

/* ---------- 2. runtime payload ---------- */

rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(join(runtimeDir, 'node_modules'), { recursive: true })
// createRequire needs a file path to anchor on; it is never read.
writeFileSync(join(runtimeDir, 'noop.cjs'), '// anchor for module resolution\n')

// The WebUI bundle's static files, for the extension host (task 12.8). The
// core's loopback server serves them token-less on a second origin so VS
// Code's web-worker extension host runs cross-origin from chrome://webdeck
// (see slides.ts). The ext-host iframe page is vendored straight from
// monaco-vscode-api, since vite does not emit it. Tolerant of a missing vite
// output: build:webui may not have run yet, in which case install-core.mjs
// copies it into the bundle later and a dev core simply keeps the worker host
// off (declarative extensions still load).
const webuiAssets = join(root, 'out', 'webui', 'assets')
const extHostIframe = join(
  root,
  'node_modules',
  '@codingame',
  'monaco-vscode-extensions-service-override',
  'vscode',
  'src',
  'vs',
  'workbench',
  'services',
  'extensions',
  'worker',
  'webWorkerExtensionHostIframe.html'
)
if (existsSync(webuiAssets)) {
  cpSync(webuiAssets, join(runtimeDir, 'webui-assets'), { recursive: true })
  if (existsSync(extHostIframe)) {
    cpSync(extHostIframe, join(runtimeDir, 'webui-assets', 'webWorkerExtensionHostIframe.html'))
  }
} else if (!asJson) {
  console.warn(
    'build-core: no out/webui/assets yet (run build:webui) — extension host assets skipped'
  )
}

for (const pkg of RUNTIME_PACKAGES) {
  const from = join(root, 'node_modules', pkg.name)
  if (!existsSync(from)) {
    console.error(`webdeck-core needs ${pkg.name} in node_modules; run npm ci`)
    process.exit(1)
  }
  for (const entry of pkg.include) {
    const src = join(from, entry)
    if (!existsSync(src)) continue
    cpSync(src, join(runtimeDir, 'node_modules', pkg.name, entry), { recursive: true })
  }
}

// node-pty's spawn-helper is exec'd, and Google Drive strips the execute bit on
// checkout (see scripts/postinstall.mjs). Restore it on the copy too.
const spawnHelper = join(
  runtimeDir,
  'node_modules',
  'node-pty',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'spawn-helper'
)
if (existsSync(spawnHelper)) chmodSync(spawnHelper, 0o755)

// Native-binary language servers (roadmap C1): gopls, rust-analyzer. Vendored
// under resources/lsp-bin/<tool>/<platform>-<arch>/ so the core can spawn them
// directly (lsp.ts). Fetched here so a core build carries them, but a failed or
// offline fetch must NOT fail the build — the script warns and ships without the
// binary (that language degrades to "not installed"). --no-sea already exited
// above, so this only runs on a full SEA build.
try {
  execFileSync(process.execPath, [join(root, 'scripts', 'fetch-lsp-bins.mjs')], {
    cwd: root,
    stdio: asJson ? 'ignore' : 'inherit'
  })
} catch {
  // The script itself never throws on a failed download; this guard only covers
  // the script being unrunnable. Never break the core build over LSP binaries.
}

// Apple's on-device model helper (Foundation Models, macOS 26): a Swift binary
// built with the system toolchain. Skipped, not failed, anywhere it cannot be
// built; the provider then reports "not in this build".
try {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-apple-llm.mjs')], {
    cwd: root,
    stdio: asJson ? 'ignore' : 'inherit'
  })
} catch {
  // Never break the core build over the helper.
}

// resources/ is looked up relative to appDir, which the core points at the
// runtime directory. js-debug, lsp-bin, dap-bin and apple-llm are vendored or
// built separately and may be absent (offline install/build); copy whatever is
// present.
mkdirSync(join(runtimeDir, 'resources'), { recursive: true })
for (const entry of ['pty-host.cjs', 'js-debug', 'lsp-bin', 'dap-bin', 'apple-llm']) {
  const src = join(root, 'resources', entry)
  if (existsSync(src)) cpSync(src, join(runtimeDir, 'resources', entry), { recursive: true })
}

// Native LSP binaries are exec'd; restore the execute bit the copy (and Google
// Drive checkout) can drop — same fix as node-pty's spawn-helper above.
for (const tool of ['rust-analyzer', 'gopls']) {
  const bin = join(
    runtimeDir,
    'resources',
    'lsp-bin',
    tool,
    `${process.platform}-${process.arch}`,
    tool
  )
  if (existsSync(bin)) chmodSync(bin, 0o755)
}
// The same for the Apple helper and the debug adapters (dlv, codelldb and the
// lldb tree beside it), which are exec'd too.
const platformDir = `${process.platform}-${process.arch}`
const appleHelper = join(runtimeDir, 'resources', 'apple-llm', platformDir, 'webdeck-apple-llm')
if (existsSync(appleHelper)) chmodSync(appleHelper, 0o755)
function chmodTree(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) chmodTree(full)
    else if (!/\.(py|txt|md|json|html|css|js)$/.test(entry.name)) chmodSync(full, 0o755)
  }
}
chmodTree(join(runtimeDir, 'resources', 'dap-bin'))

// js-debug ships prebuilt native addons for every platform it supports, so the
// mac runtime picks up Windows PE and Linux ELF `.node` files it will never
// load. They are dead weight, and worse for release: a foreign executable
// inside a macOS app is not a Mach-O codesign can seal, so it reads as unsigned
// code and complicates notarization. Keep only this platform's, matched by the
// platform token in the filename (js-debug names them e.g. `*.win32-x64-msvc`,
// `*.linux-x64`, `*.darwin-arm64`).
const keepToken = `${process.platform}-`
const foreignPlatforms = ['win32-', 'linux-', 'darwin-', 'android-'].filter(
  (token) => token !== keepToken
)
function pruneForeignNative(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      pruneForeignNative(full)
    } else if (
      entry.name.endsWith('.node') &&
      foreignPlatforms.some((t) => entry.name.includes(t))
    ) {
      rmSync(full, { force: true })
    }
  }
}
pruneForeignNative(join(runtimeDir, 'resources'))

/* ---------- 3. single executable ---------- */

const baseNode = await ensureNodeRuntime({ quiet: asJson })
const seaDir = join(outdir, '.sea')
rmSync(seaDir, { recursive: true, force: true })
mkdirSync(seaDir, { recursive: true })

const seaMain = join(seaDir, 'main.cjs')
writeFileSync(seaMain, SEA_PROLOGUE + readFileSync(bundleFile, 'utf8') + SEA_EPILOGUE)

const seaBlob = join(seaDir, 'sea-prep.blob')
writeFileSync(
  join(seaDir, 'sea-config.json'),
  JSON.stringify(
    {
      main: seaMain,
      output: seaBlob,
      // The warning goes to stderr on every launch and the browser inherits it.
      disableExperimentalSEAWarning: true,
      // A startup snapshot would shave the parse cost, but it runs the bundle's
      // top level at build time — and this bundle opens sockets and touches the
      // filesystem there. Code cache gets most of the win with none of that.
      useSnapshot: false,
      useCodeCache: true
    },
    null,
    2
  )
)

// Generate the blob with the SAME runtime we are about to inject it into: the
// blob carries a format version that the embedding Node checks.
execFileSync(baseNode, ['--experimental-sea-config', join(seaDir, 'sea-config.json')], {
  cwd: seaDir,
  stdio: asJson ? 'ignore' : 'inherit'
})

rmSync(exeFile, { force: true })
cpSync(baseNode, exeFile)
chmodSync(exeFile, 0o755)

// postject rewrites the executable's load commands. On macOS that invalidates
// whatever signature the Node download carried, so strip it first and re-sign
// after — the sequence Node's own SEA documentation prescribes, and an
// unsigned, load-command-edited Mach-O is killed by the kernel on arm64.
// codesign is a macOS-only tool (it is absent on the Linux CI runners), so on
// any other platform the ELF/PE SEA is edited in place with no signing step.
const isMac = process.platform === 'darwin'
if (isMac) execFileSync('codesign', ['--remove-signature', exeFile], { stdio: 'inherit' })
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'postject', 'dist', 'cli.js'),
    exeFile,
    'NODE_SEA_BLOB',
    seaBlob,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--macho-segment-name',
    'NODE_SEA'
  ],
  { stdio: asJson ? 'ignore' : 'inherit' }
)
// Ad-hoc only, and macOS-only (see isMac above). A real Developer ID signature
// is applied later by Chromium's sign_chrome.py, which re-signs every part of
// the bundle anyway; signing here just proves the binary is well-formed enough
// to sign at all, and leaves it runnable (an unsigned, load-command-edited
// Mach-O is killed by the kernel on arm64). A Linux/Windows SEA needs no signature.
if (isMac) execFileSync('codesign', ['--sign', '-', exeFile], { stdio: 'inherit' })

rmSync(seaDir, { recursive: true, force: true })

const size = statSync(exeFile).size
const summary = {
  executable: exeFile,
  runtimeDir,
  bundle: bundleFile,
  modules: inputs.length,
  bytes: size,
  nodeVersion: nodeRuntimeVersion(baseNode),
  electronFree: true
}
if (asJson) {
  console.log(JSON.stringify(summary))
} else {
  console.log(
    `webdeck-core -> ${exeFile} (${(size / 1e6).toFixed(1)} MB, ${inputs.length} modules, ` +
      `Node ${summary.nodeVersion}, Electron-free)`
  )
  console.log(`webdeck-core runtime -> ${runtimeDir}`)
}
