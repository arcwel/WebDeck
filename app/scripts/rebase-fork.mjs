#!/usr/bin/env node
// Rebase the fork onto a newer Chromium base — the pipeline half of
// TASKS.md 13.7b. The fork is three things on top of a pristine Chromium tag
// (chromium/fork.json): branding.diff, upstream-edits.diff and the copied-in
// new-file trees. Rebasing is applying those to the new tag, then building
// and running the gates; a rebase that compiles but breaks chrome://webdeck
// must fail, so the gates are part of the pipeline, not a suggestion.
//
//   --check   Do not touch the working tree: apply both patches to a
//             temporary index built from the target tag and report what
//             conflicts. Exit 1 on any conflict, 2 if the check could not run.
//   --apply   Create branch webdeck-base-<version> at the tag, apply the
//             patches with three-way merge, copy the new-file trees, and
//             rewrite chromium/fork.json. Stops at the first conflict and
//             leaves the tree for a human; never force-pushes anything.
//
// The build and the gates are separate steps the workflow runs after --apply
// (see .github/workflows/rebase-fork.yml): pack:webui:release, autoninja,
// verify:patches, verify:fork, verify:hardening --release.
//
// Usage: node scripts/rebase-fork.mjs --to <version> (--check | --apply)
//                                    [--checkout <src>] [--json]
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(appRoot)
const forkPath = join(repoRoot, 'chromium', 'fork.json')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

if (flag('help') || flag('h')) {
  console.log(`rebase-fork — apply the fork's patch set onto a newer Chromium base

  --to <version>      the Chromium tag to move to (e.g. 154.0.8100.3)
  --check             dry run against a temporary index; reports conflicts
  --apply             branch, apply with 3-way merge, copy new-file trees, update fork.json
  --checkout <src>    the Chromium checkout (default: "checkout" in chromium/fork.json)
  --json              machine-readable result

Exit: 0 clean · 1 conflict · 2 could not run`)
  process.exit(0)
}

const fork = JSON.parse(readFileSync(forkPath, 'utf8'))
const checkout = resolve(arg('checkout', process.env.WEBDECK_CHROMIUM_SRC || fork.checkout || ''))
const to = arg('to')
const json = flag('json')
const out = {
  ok: true,
  to,
  from: fork.base,
  mode: flag('apply') ? 'apply' : 'check',
  patches: [],
  trees: []
}

function fail(status, message) {
  out.ok = false
  out.error = message
  if (json) console.log(JSON.stringify(out, null, 2))
  else console.error(`rebase-fork: ${message}`)
  process.exit(status)
}

if (!to) fail(2, 'pass --to <version>')
if (!flag('check') && !flag('apply')) fail(2, 'pass --check or --apply')
if (!checkout || !existsSync(join(checkout, '.git')))
  fail(2, `no Chromium checkout at ${checkout || '(unset)'}`)

function git(args, opts = {}) {
  return spawnSync('git', args, {
    cwd: checkout,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opts
  })
}

// The tag must exist locally; fetching it is the one network step, and it is
// explicit so an offline dry run says so instead of hanging.
if (git(['rev-parse', '--verify', '--quiet', `refs/tags/${to}^{commit}`]).status !== 0) {
  const fetched = git(['fetch', '--depth=1', 'origin', `refs/tags/${to}:refs/tags/${to}`])
  if (fetched.status !== 0)
    fail(
      2,
      `tag ${to} is not in the checkout and could not be fetched: ${fetched.stderr.trim().split('\n').pop()}`
    )
}

const patchPaths = fork.patches.map((p) => join(repoRoot, 'chromium', p))
for (const p of patchPaths) if (!existsSync(p)) fail(2, `patch missing: ${p}`)

if (flag('check')) {
  // A throwaway index holding the target tag's tree: patches apply to it with
  // --cached, so the working tree and the real index are never touched.
  const tmp = mkdtempSync(join(tmpdir(), 'webdeck-rebase-'))
  const index = join(tmp, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    const read = git(['read-tree', to], { env })
    if (read.status !== 0) fail(2, `could not read tree ${to}: ${read.stderr.trim()}`)
    for (const patch of patchPaths) {
      const check = git(['apply', '--cached', '--check', patch], { env })
      const entry = {
        path: patch.replace(repoRoot + '/', ''),
        status: check.status === 0 ? 'applies' : 'conflict'
      }
      if (check.status !== 0) {
        entry.detail = check.stderr
          .trim()
          .split('\n')
          .filter((l) => /error:|conflict|does not apply|patch failed/.test(l))
          .slice(0, 12)
        out.patches.push(entry)
        out.ok = false
        continue
      }
      // Apply it for real to the temp index so the next patch sees it.
      git(['apply', '--cached', patch], { env })
      out.patches.push(entry)
    }
    for (const tree of fork.newFileTrees) {
      out.trees.push({
        path: tree,
        status: existsSync(join(repoRoot, 'chromium', tree)) ? 'present' : 'missing'
      })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`rebase-fork --check: ${fork.base} -> ${to}`)
    for (const p of out.patches)
      console.log(
        `  ${p.status === 'applies' ? '✓' : '✗'} ${p.path}${p.detail ? '\n      ' + p.detail.join('\n      ') : ''}`
      )
    for (const t of out.trees)
      console.log(`  ${t.status === 'present' ? '✓' : '✗'} ${t.path} (copied as is)`)
    console.log(
      out.ok
        ? 'clean: the patch set applies to the new base'
        : 'CONFLICT: the fork cannot be rebased without a human'
    )
  }
  process.exit(out.ok ? 0 : 1)
}

// --apply
const branch = `webdeck-base-${to}`
const dirty = git(['status', '--porcelain']).stdout.trim()
if (dirty) fail(2, 'the checkout has uncommitted changes; commit or stash them first')
const co = git(['checkout', '-B', branch, `refs/tags/${to}`])
if (co.status !== 0) fail(2, `could not branch at ${to}: ${co.stderr.trim()}`)
for (const patch of patchPaths) {
  const applied = git(['apply', '--3way', '--index', patch])
  const entry = {
    path: patch.replace(repoRoot + '/', ''),
    status: applied.status === 0 ? 'applied' : 'conflict'
  }
  out.patches.push(entry)
  if (applied.status !== 0) {
    entry.detail = applied.stderr.trim().split('\n').slice(-12)
    out.ok = false
    if (json) console.log(JSON.stringify(out, null, 2))
    else
      console.error(
        `CONFLICT applying ${entry.path} on ${branch}:\n  ${entry.detail.join('\n  ')}\nResolve in the checkout, then re-cut chromium/patches/upstream-edits.diff from it.`
      )
    process.exit(1)
  }
  if (patch.endsWith('branding.diff')) {
    // Branding is a commit on the branch, not a working-tree edit (fork.json).
    git(['commit', '-q', '-m', 'webdeck: rebrand Chromium -> Arcwel WebDeck'])
  }
}
for (const tree of fork.newFileTrees) {
  const src = join(repoRoot, 'chromium', tree)
  const dest = join(checkout, tree.replace(/^patches\//, ''))
  cpSync(src, dest, { recursive: true })
  out.trees.push({ path: tree, status: 'copied' })
}
const next = { ...fork, base: to, milestone: Number(to.split('.')[0]), branch }
writeFileSync(forkPath, JSON.stringify(next, null, 2) + '\n')
out.forkJson = { base: to, branch }
if (json) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`rebased onto ${to} on branch ${branch}; chromium/fork.json updated.`)
  console.log(
    'Next: npm run pack:webui:release && autoninja -C <out> chrome && npm run verify:fork:all'
  )
}
execFileSync('git', ['-C', checkout, 'status', '--short'], { stdio: 'inherit' })
