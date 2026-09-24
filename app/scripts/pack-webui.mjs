#!/usr/bin/env node
// Packs the built WebDeck UI into the Chromium fork as chrome://webdeck
// resources: copies out/webui into the checkout and regenerates the .grd and
// BUILD.gn from what is actually there.
//
// Generated rather than hand-maintained because the bundle is ~170 files and
// changes whenever a chunk splits differently — a hand-written list would be
// wrong within a day, and grit fails loudly on a missing file but silently
// serves nothing for one that was never listed.
//
// Usage: node scripts/pack-webui.mjs [--chromium <src dir>]
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { checkBindingsAgainstBuild } from './mojo-ids.mjs'
import { fileURLToPath } from 'node:url'
import { chromiumSrc as resolveChromiumSrc } from './chromium-src.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const chromiumSrc = resolveChromiumSrc()

const built = join(root, 'out', 'webui')
const destRel = 'chrome/browser/resources/webdeck'
const dest = join(chromiumSrc, destRel)

if (!existsSync(built)) {
  console.error(`No WebUI build at ${built}. Run: npx vite build --config vite.webui.config.ts`)
  process.exit(1)
}
if (!existsSync(chromiumSrc)) {
  console.error(`Chromium checkout not found at ${chromiumSrc}`)
  process.exit(1)
}

/** Every file in the built bundle, as forward-slash paths relative to its root. */
function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out.sort()
}

const files = walk(built)
if (!files.includes('index.html')) {
  console.error('The bundle has no index.html — refusing to pack a broken page.')
  process.exit(1)
}

// Replace the previous bundle wholesale: a stale chunk left behind would be
// packed into the binary and never served.
//
// Created before it is listed: on a freshly fetched checkout this directory
// does not exist yet (it is build output, deliberately not in the patch set),
// and listing it first threw ENOENT before anything was packed.
mkdirSync(dest, { recursive: true })
for (const entry of readdirSync(dest)) {
  if (entry === 'BUILD.gn' || entry === 'webdeck_resources.grd') continue
  rmSync(join(dest, entry), { recursive: true, force: true })
}
cpSync(built, dest, { recursive: true })

// The page's Mojo bindings must carry the message ids of the build that will
// serve them. An official build scrambles the ids; the component build does
// not; a mojom edit renumbers both. Packing bindings from the wrong out dir
// ships a page the browser kills at its first Shell call — so refuse it here,
// where it is cheap, rather than find it in a release candidate.
// --bootstrap breaks a cycle that only a fresh checkout meets. The patched
// chrome/browser/resources/BUILD.gn names this directory's target, so `gn gen`
// fails until the BUILD.gn below exists — and the Mojo check needs bindings
// that only a generated build directory can produce. A bootstrap pack writes
// the build files so `gn gen` can run; it is never a pack to build a browser
// from, and the real pack (pack:webui:release) re-checks before that.
const bootstrap = process.argv.includes('--bootstrap')
if (bootstrap) {
  console.warn(
    'BOOTSTRAP pack: Mojo ids NOT checked. This only lets `gn gen` run on a fresh\n' +
      'checkout. Build the generator, then run `npm run pack:webui:release` before\n' +
      'building chrome, or the page may be killed at its first Shell call.'
  )
} else {
  const buildIndex = process.argv.indexOf('--build-dir')
  const buildDir =
    buildIndex !== -1 && process.argv[buildIndex + 1] ? process.argv[buildIndex + 1] : 'out/webdeck'
  const bindings = join(built, 'mojo', 'webdeck.mojom-webui.js')
  let result
  try {
    result = checkBindingsAgainstBuild(bindings, chromiumSrc, buildDir)
  } catch (error) {
    console.error(`cannot check the Mojo bindings against ${buildDir}: ${error.message}`)
    console.error(
      `build the generator first: autoninja -C ${buildDir} chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator`
    )
    process.exit(2)
  }
  if (!result.ok) {
    console.error(`Mojo bindings do not match ${buildDir} (${result.headerPath}):`)
    for (const m of result.mismatches.slice(0, 5)) {
      console.error(`  ${m.key}: page sends ${m.page}, browser expects ${m.browser}`)
    }
    for (const key of result.missing.slice(0, 5)) console.error(`  ${key}: unknown to this build`)
    console.error(
      `regenerate them for this build: node scripts/gen-mojo-bindings.mjs --build-dir ${buildDir} && npm run build:webui`
    )
    process.exit(1)
  }
  console.log(`mojo bindings match ${buildDir} (${result.methods} methods)`)
}

/** IDR_WEBDECK_ASSETS_INDEX_JS from assets/index.js. */
const idFor = (path) => `IDR_WEBDECK_${path.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`

const includes = files
  .map(
    (f) =>
      `      <include name="${idFor(f)}"\n` +
      `               file="${f}"\n` +
      `               resource_path="${f}"\n` +
      `               type="BINDATA" />`
  )
  .join('\n')

writeFileSync(
  join(dest, 'webdeck_resources.grd'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2026 Arcwel. All rights reserved.

     GENERATED by app/scripts/pack-webui.mjs — do not edit by hand.

     The WebDeck UI is bundled by the app's own toolchain (Vite) and packed here
     as-is, rather than compiled by build_webui: that template builds TypeScript
     and rejects .js in static_files. Packing the built output means the exact
     same bundle runs under Electron today and the fork tomorrow.
-->
<grit latest_public_release="0" current_release="1">
  <outputs>
    <output filename="grit/webdeck_resources.h" type="rc_header">
      <emit emit_type='prepend'></emit>
    </output>
    <output filename="grit/webdeck_resources_map.cc" type="resource_file_map_source" />
    <output filename="grit/webdeck_resources_map.h" type="resource_map_header" />
    <output filename="webdeck_resources.pak" type="data_package" />
  </outputs>
  <release seq="1">
    <includes>
${includes}
    </includes>
  </release>
</grit>
`
)

writeFileSync(
  join(dest, 'BUILD.gn'),
  `# Copyright 2026 Arcwel. All rights reserved.
#
# GENERATED by app/scripts/pack-webui.mjs — do not edit by hand.

import("//tools/grit/grit_rule.gni")

grit("resources") {
  source = "webdeck_resources.grd"

  inputs = [
${files.map((f) => `    "${f}",`).join('\n')}
  ]

  outputs = [
    "grit/webdeck_resources.h",
    "grit/webdeck_resources_map.cc",
    "grit/webdeck_resources_map.h",
    "webdeck_resources.pak",
  ]
  output_dir = "$root_gen_dir/chrome"
}
`
)

// grit allocates ids from a fixed-size range; too small a range fails the build
// with an unhelpful error, so size it here from the real file count.
const spec = join(chromiumSrc, 'tools', 'gritsettings', 'resource_ids.spec')
// grit consumes ~2 ids per include, so size from double the file count.
const slots = Math.max(100, Math.ceil((files.length * 2 + 50) / 100) * 100)
try {
  const current = execFileSync('grep', ['-n', 'webdeck_resources.grd', spec], { encoding: 'utf8' })
  console.log(`resource_ids.spec: ${current.trim()} (needs >= ${files.length} slots)`)
} catch {
  console.warn('resource_ids.spec has no webdeck entry — the grit build will fail.')
}

const total = files.reduce((n, f) => n + statSync(join(built, f)).size, 0)
console.log(
  `packed ${files.length} files (${(total / 1024 / 1024).toFixed(1)} MB) -> ${destRel}\n` +
    `suggested "includes" size in resource_ids.spec: ${slots}`
)
