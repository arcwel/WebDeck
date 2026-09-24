#!/usr/bin/env node
// Turns Chromium's generated Mojo TypeScript bindings into a plain ES module
// the WebDeck page can load at runtime.
//
// The generated file cannot go through Vite or tsc. It imports
// `//resources/mojo/mojo/public/js/bindings.js`, which exists only for a WebUI
// page inside the browser, and it references Chromium-only globals like
// MojoHandle. Bundling it would fail the build on every host that is not the
// fork; typechecking it would fail everywhere.
//
// So it is transpiled once, with that import left external, and shipped as a
// static asset. The page loads it with a runtime import the bundler ignores.
//
// --build-dir matters. An official build SCRAMBLES Mojo message IDs (a hash
// per chrome/VERSION instead of 0, 1, 2…), so bindings generated from the
// component build send ordinals the release browser does not recognise — and
// it kills the renderer for a bad IPC message at the page's first Shell call.
// Generate from the out dir you are about to pack for; pack-webui.mjs refuses
// a mismatch (see mojo-ids.mjs).
//
// Usage: node scripts/gen-mojo-bindings.mjs [--chromium <src>] [--build-dir <out dir>]
import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromiumSrc } from './chromium-src.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const chromium = chromiumSrc()
const buildDir = arg('build-dir', 'out/webdeck')

const generated = join(
  chromium,
  buildDir,
  'gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-webui.ts'
)
const outFile = join(root, 'src/renderer/public/mojo/webdeck.mojom-webui.js')

if (!existsSync(generated)) {
  console.error(`no generated bindings at ${generated}`)
  console.error('build them first:')
  console.error(
    `  autoninja -C ${buildDir} chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator`
  )
  process.exit(2)
}

mkdirSync(dirname(outFile), { recursive: true })

await build({
  entryPoints: [generated],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  // The browser resolves this, not us. Bundling it is impossible and inlining
  // a stub would produce a module that silently does nothing.
  external: ['//resources/*'],
  logLevel: 'warning',
  banner: { js: `// GENERATED from ${buildDir} by scripts/gen-mojo-bindings.mjs — do not edit.` }
})

console.log(`mojo bindings (${buildDir}) -> ${outFile.replace(root + '/', '')}`)
