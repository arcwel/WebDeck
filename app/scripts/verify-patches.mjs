#!/usr/bin/env node
// Asserts that chromium/patches/ still describes the fork in the checkout —
// that the repo alone could rebuild the browser we ship.
//
// This exists because it silently stopped being true. The branding change lived
// only in the checkout as a commit and was in no patch; upstream-edits.diff had
// drifted from the tree it was cut from; and the WebUI source files in the repo
// were missing a CSP the built browser has. Everything still built, because the
// checkout was already correct — the repo was the broken copy, and nothing
// looked at it. A rebase pipeline reads the repo, so that gap would have
// surfaced as a mystery regression on the first upstream bump.
//
// Usage: node scripts/verify-patches.mjs [--fork <fork.json>] [--checkout <src>] [--json]
// Exit codes: 0 in sync · 1 the repo does not describe the fork · 2 could not check
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const asJson = process.argv.includes('--json')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`verify-patches — does chromium/patches/ still describe the fork?

  --fork <path>      fork.json (default: chromium/fork.json)
  --checkout <path>  Chromium src dir (default: the checkout named in fork.json)
  --json             machine-readable result

Exit: 0 in sync · 1 repo does not describe the fork · 2 could not check`)
  process.exit(0)
}

const findings = []
const note = (level, what, detail) => findings.push({ level, what, detail })

function cannotCheck(reason) {
  if (asJson) console.log(JSON.stringify({ status: 'error', reason }, null, 2))
  else console.error(`cannot check: ${reason}`)
  process.exit(2)
}

const forkPath = resolve(arg('fork', join(repoRoot, 'chromium', 'fork.json')))
if (!existsSync(forkPath)) cannotCheck(`no fork.json at ${forkPath}`)

let fork
try {
  fork = JSON.parse(readFileSync(forkPath, 'utf8'))
} catch (err) {
  cannotCheck(`fork.json is not valid JSON: ${err.message}`)
}

const checkout = resolve(arg('checkout', fork.checkout ?? ''))
if (!checkout || !existsSync(join(checkout, '.git'))) {
  cannotCheck(`no Chromium checkout at ${checkout || '(unset)'} — pass --checkout`)
}

const git = (...args) =>
  execFileSync('git', args, { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

/**
 * A patch describes the tree exactly when it REVERSES cleanly against it.
 * Applying forward is the wrong test: the checkout already has our changes, so
 * a correct patch "fails to apply" there — the false negative that hid the
 * drift in the first place.
 */
function patchDescribesTree(patchPath) {
  try {
    execFileSync('git', ['apply', '--check', '-R', patchPath], { cwd: checkout, stdio: 'pipe' })
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      detail: String(err.stderr ?? err.message)
        .trim()
        .split('\n')[0]
    }
  }
}

// 1. Every patch in the manifest still describes the checkout.
for (const rel of fork.patches ?? []) {
  const patchPath = join(dirname(forkPath), rel)
  if (!existsSync(patchPath)) {
    note('error', `patch missing: ${rel}`, 'named in fork.json but not on disk')
    continue
  }
  const result = patchDescribesTree(patchPath)
  if (result.ok) note('ok', rel, 'describes the checkout')
  else note('error', rel, `has drifted from the checkout — ${result.detail}`)
}

/** Every file under a directory, relative to it. */
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, base, out)
    else out.push(relative(base, full))
  }
  return out
}

// 2. Every new-file tree matches the checkout byte for byte. These are our own
//    source files; a difference here means the repo would build a different
//    browser (this is how the frame-src CSP went missing).
for (const rel of fork.newFileTrees ?? []) {
  const stored = join(dirname(forkPath), rel)
  const live = join(checkout, rel.replace(/^patches\//, ''))
  if (!existsSync(stored)) {
    note('error', rel, 'named in fork.json but not stored in the repo')
    continue
  }
  if (!existsSync(live)) {
    note('error', rel, `stored in the repo but absent from the checkout at ${live}`)
    continue
  }
  const storedFiles = new Set(walk(stored))
  const liveFiles = new Set(walk(live))
  const missing = [...liveFiles].filter((f) => !storedFiles.has(f))
  const extra = [...storedFiles].filter((f) => !liveFiles.has(f))
  const differing = [...storedFiles]
    .filter((f) => liveFiles.has(f))
    .filter((f) => readFileSync(join(stored, f), 'utf8') !== readFileSync(join(live, f), 'utf8'))

  if (missing.length) note('error', rel, `in the checkout but not the repo: ${missing.join(', ')}`)
  if (extra.length) note('warn', rel, `in the repo but not the checkout: ${extra.join(', ')}`)
  if (differing.length) note('error', rel, `contents differ: ${differing.join(', ')}`)
  if (!missing.length && !extra.length && !differing.length) {
    note('ok', rel, `${storedFiles.size} file(s) match the checkout`)
  }
}

// 3. Nothing of ours in the checkout is unaccounted for. This is the check that
//    would have caught the branding commit: it was real, it was ours, and no
//    patch mentioned it.
try {
  const base = fork.baseRef ?? git('merge-base', 'HEAD', `tags/${fork.base}`).trim()
  const commits = git('log', '--oneline', `${base}..HEAD`).trim()
  const ours = commits ? commits.split('\n') : []
  // Each commit on the branch must be represented by a patch. We can only match
  // by touched paths, so report the commit and let a human confirm.
  const patchText = (fork.patches ?? [])
    .map((rel) => {
      const p = join(dirname(forkPath), rel)
      return existsSync(p) ? readFileSync(p, 'utf8') : ''
    })
    .join('\n')
  for (const line of ours) {
    const sha = line.split(' ')[0]
    const touched = git('show', '--name-only', '--format=', sha).trim().split('\n').filter(Boolean)
    const covered = touched.every((f) => patchText.includes(f))
    if (covered) note('ok', `commit ${line}`, 'covered by the patch set')
    else {
      note(
        'error',
        `commit ${line}`,
        `touches files no patch mentions: ${touched.filter((f) => !patchText.includes(f)).join(', ')}`
      )
    }
  }
  if (!ours.length) note('ok', 'branch commits', 'none beyond the base')
} catch (err) {
  note('warn', 'branch commits', `could not enumerate: ${err.message.split('\n')[0]}`)
}

// 4. Modified upstream files must all be covered by a patch.
try {
  const modified = git('status', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith(' M ') || l.startsWith('M  '))
    .map((l) => l.slice(3).trim())
  const patchText = (fork.patches ?? [])
    .map((rel) => {
      const p = join(dirname(forkPath), rel)
      return existsSync(p) ? readFileSync(p, 'utf8') : ''
    })
    .join('\n')
  const uncovered = modified.filter((f) => !patchText.includes(f))
  if (uncovered.length) {
    note('error', 'modified upstream files', `no patch covers: ${uncovered.join(', ')}`)
  } else {
    note('ok', 'modified upstream files', `all ${modified.length} covered`)
  }
} catch (err) {
  note('warn', 'modified upstream files', `could not enumerate: ${err.message.split('\n')[0]}`)
}

// 5. The build config the repo records is the one the checkout builds with.
//    args.gn lives in the output directory, which git never sees, so it is the
//    one input that could drift without any diff showing it. Compared on the
//    values alone: comments are free to differ.
{
  const recorded = join(repoRoot, 'chromium', 'build', 'webdeck-release.args.gn')
  const live = join(checkout, 'out', 'webdeck-release', 'args.gn')
  // webdeck_dev_keychain is the one line a release build legitimately drops
  // (chromium/RELEASING.md), so it is left out of the comparison and reported
  // instead. Shipping a dev-keychain build is already refused by package-fork.
  const DEV_KEYCHAIN = /^webdeck_dev_keychain\s*=\s*true$/
  const lines = (file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
  const values = (file) =>
    lines(file)
      .filter((line) => !/^webdeck_dev_keychain\b/.test(line))
      .join('\n')
  if (!existsSync(recorded)) {
    note('error', 'build config', 'chromium/build/webdeck-release.args.gn is missing')
  } else if (!existsSync(live)) {
    // A fresh checkout before `gn gen`: nothing to compare yet, and not wrong.
    note(
      'warn',
      'build config',
      `no ${relative(checkout, live)} yet — install it (chromium/SETUP.md step 5)`
    )
  } else if (values(recorded) !== values(live)) {
    note(
      'error',
      'build config',
      `out/webdeck-release/args.gn differs from chromium/build/webdeck-release.args.gn — update the recorded copy or re-install it, then gn gen`
    )
  } else {
    const mode = lines(live).some((line) => DEV_KEYCHAIN.test(line))
      ? 'dev keychain'
      : 'release keychain'
    note('ok', 'build config', `out/webdeck-release/args.gn matches the recorded copy (${mode})`)
  }
}

const errors = findings.filter((f) => f.level === 'error')
const exitCode = errors.length ? 1 : 0

if (asJson) {
  console.log(
    JSON.stringify(
      { status: exitCode === 0 ? 'in-sync' : 'drifted', base: fork.base, checkout, findings },
      null,
      2
    )
  )
} else {
  console.log(`Arcwel WebDeck — patch set vs checkout (${fork.base})\n`)
  for (const f of findings) {
    const mark = f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✗'
    console.log(`  ${mark} ${f.what}\n      ${f.detail}`)
  }
  console.log(
    exitCode === 0
      ? '\nThe repo describes the fork.'
      : `\n${errors.length} problem(s): the repo could NOT rebuild this browser.`
  )
}
process.exit(exitCode)
