#!/usr/bin/env node
// Has our forked Chromium base fallen behind upstream — and does our patch set
// still apply to it? (TASKS.md 13.7a)
//
// The version delta is the easy half: read chromium/fork.json, ask chromiumdash
// what the channel is on now, compare the two as numbers. The half that
// actually matters is the patch set. A fork rots silently: upstream moves, a
// hunk stops applying, and nothing says so until someone attempts a rebase
// weeks later. So this reports per-patch applicability — and when it cannot run
// that check it says "not checked", never "fine". A green line here must always
// mean a check that really ran.
//
// Deliberately dependency-free (plain node:https) so it can run from a cron box
// with nothing installed but Node.
//
// Usage: node scripts/upstream-check.mjs [--channel stable|beta|dev] [--json]
//        node scripts/upstream-check.mjs --help
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { get } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(appRoot)

const EXIT_OK = 0
const EXIT_ACTION = 1
const EXIT_ERROR = 2
const FETCH_TIMEOUT_MS = 15000

/** The tracked edits to existing upstream files, relative to the repo root. */
const PATCH_FILE = 'chromium/patches/upstream-edits.diff'

/** Our channel names -> the ones chromiumdash's API expects. */
export const CHANNELS = { stable: 'Stable', beta: 'Beta', dev: 'Dev' }

const HELP = `upstream-check — has our forked Chromium base fallen behind upstream, and does
our patch set still apply to it?

Usage
  npm run upstream:check -- [options]
  node scripts/upstream-check.mjs [options]

Options
  --channel <stable|beta|dev>     Upstream channel to compare against.
                                  Default: "channel" in chromium/fork.json.
  --platform <Mac|Windows|Linux>  chromiumdash platform.
                                  Default: "platform" in chromium/fork.json.
  --checkout <path>               Chromium checkout to test the patch set
                                  against. Default: $WEBDECK_CHROMIUM_SRC, else
                                  "checkout" in chromium/fork.json.
  --json                          Emit the result as JSON on stdout.
  --help, -h                      This text.

Exit codes
  0  up to date — our pin matches (or leads) upstream, and no tracked patch conflicts
  1  action needed — we are behind upstream, or a tracked patch no longer applies
  2  error — the check could not be completed (network, unreadable pin or patch).
     Never returned as "up to date": a check that did not run is not a pass.

What the patch check does and does not prove
  It runs \`git apply --check --cached\` for each file in the patch, against
  whatever version the local checkout is pinned to — normally our current base,
  NOT the newer upstream base. So it catches drift between chromium/patches/
  and the tree; it does not predict the rebase. The output always names the
  version it checked against, and says "not checked: no Chromium checkout at
  <path>" when there is nothing to check.

Where the pin lives
  chromium/fork.json. Update "base" after every rebase — this check is only as
  honest as that number.`

/**
 * "153.0.8010.12" -> [153, 0, 8010, 12]; anything else -> null. Strict on
 * purpose: a version we cannot parse must fail the run, not quietly compare
 * equal to something.
 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const parts = text.trim().split('.')
  if (parts.length !== 4) return null
  if (!parts.every((part) => /^\d+$/.test(part))) return null
  return parts.map(Number)
}

/** Component-wise numeric compare. -1 if a < b, 1 if a > b, 0 if equal. */
export function compareVersions(a, b) {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * The whole verdict, from already-gathered facts. Pure — every I/O result is
 * passed in — so the comparison and the exit-code choice are testable without
 * a network or a checkout.
 */
export function buildResult({ channel, platform, pinned, upstream, patches, security }) {
  const ours = parseVersion(pinned.version)
  const theirs = parseVersion(upstream.version)
  if (!ours) throw new Error(`unparseable pinned version: ${JSON.stringify(pinned.version)}`)
  if (!theirs) throw new Error(`unparseable upstream version: ${JSON.stringify(upstream.version)}`)

  const comparison = compareVersions(ours, theirs)
  const result = {
    ok: true,
    status: comparison < 0 ? 'behind' : comparison > 0 ? 'ahead' : 'current',
    channel,
    platform,
    pinned: { version: pinned.version, milestone: ours[0], source: pinned.source },
    upstream: {
      version: upstream.version,
      milestone: upstream.milestone ?? theirs[0],
      released: upstream.released ?? null
    },
    delta: { comparison, milestones: theirs[0] - ours[0] },
    patches,
    security: security ?? { checked: false, reason: 'not requested' }
  }
  return { ...result, exitCode: exitCodeFor(result) }
}

/**
 * 1 for anything a human has to act on. A conflicting patch counts: a fork that
 * is current but can no longer be rebuilt from its own patches is exactly the
 * silent rot this check exists to catch.
 */
export function exitCodeFor(result) {
  if (!result.ok) return EXIT_ERROR
  if (result.status === 'behind') return EXIT_ACTION
  if (result.patches?.checked && result.patches.conflicts > 0) return EXIT_ACTION
  return EXIT_OK
}

/** The pin, from the one machine-readable place that has it. */
function readPin() {
  const file = join(repoRoot, 'chromium', 'fork.json')
  if (!existsSync(file))
    throw new Error(`no pin at ${file} — the fork's base version is unrecorded`)
  let pin
  try {
    pin = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`chromium/fork.json is not valid JSON: ${error.message}`, { cause: error })
  }
  if (!parseVersion(pin.base)) {
    throw new Error(
      `chromium/fork.json "base" is not a Chromium version: ${JSON.stringify(pin.base)}`
    )
  }
  return pin
}

/** GET a JSON document. No redirects: a redirect is reported, not followed. */
function fetchJson(url) {
  return new Promise((settle, reject) => {
    const request = get(
      url,
      { headers: { 'user-agent': 'webdeck-upstream-check' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`${url} returned HTTP ${response.statusCode}`))
          return
        }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => {
          try {
            settle(JSON.parse(body))
          } catch {
            reject(new Error(`${url} returned malformed JSON`))
          }
        })
      }
    )
    request.setTimeout(FETCH_TIMEOUT_MS, () =>
      request.destroy(new Error(`${url} timed out after ${FETCH_TIMEOUT_MS} ms`))
    )
    request.on('error', reject)
  })
}

/**
 * The current upstream release for a channel. The HTML dashboards render
 * client-side and return nothing useful; this JSON endpoint is the real API.
 */
async function fetchUpstream(channel, platform) {
  const url =
    'https://chromiumdash.appspot.com/fetch_releases' +
    `?channel=${CHANNELS[channel]}&platform=${platform}&num=1`
  const releases = await fetchJson(url)
  const release = Array.isArray(releases) ? releases[0] : null
  if (!release || !parseVersion(release.version)) {
    throw new Error(
      `chromiumdash reported no ${CHANNELS[channel]} release for platform ${platform}`
    )
  }
  return {
    version: release.version,
    milestone: release.milestone,
    released: release.time ? new Date(release.time).toISOString() : null
  }
}

/** The b-side path of every file a unified diff touches. */
function filesInDiff(diff) {
  return [...diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)].map((match) => match[1])
}

/** MAJOR/MINOR/BUILD/PATCH from a checkout's chrome/VERSION, or null. */
function checkoutVersion(checkout) {
  try {
    const fields = Object.fromEntries(
      readFileSync(join(checkout, 'chrome', 'VERSION'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('='))
    )
    const version = ['MAJOR', 'MINOR', 'BUILD', 'PATCH'].map((key) => fields[key]?.trim()).join('.')
    return parseVersion(version) ? version : null
  } catch {
    return null
  }
}

function git(checkout, args) {
  return spawnSync('git', ['-C', checkout, ...args], { encoding: 'utf8' })
}

/**
 * Per-file applicability of chromium/patches/upstream-edits.diff.
 *
 * `--cached` checks against the index rather than the working tree: the tree
 * normally has the patch applied by hand, and checking that would report a
 * conflict for every hunk. `--include` narrows each run to one file so the
 * status comes from git's own exit code instead of parsing its stderr.
 *
 * Returns `{ checked: false, reason }` whenever the check cannot run — the one
 * thing this function must never do is imply a pass it did not observe.
 */
function checkPatchSet(checkout, upstreamVersion) {
  const patchPath = join(repoRoot, PATCH_FILE)
  const base = {
    checked: false,
    checkoutPath: checkout,
    patchFile: PATCH_FILE,
    files: [],
    conflicts: 0
  }

  if (!existsSync(patchPath)) {
    return { ...base, reason: `no patch file at ${patchPath}` }
  }
  if (!existsSync(checkout)) {
    return { ...base, reason: `no Chromium checkout at ${checkout}` }
  }
  if (git(checkout, ['rev-parse', '--git-dir']).status !== 0) {
    return { ...base, reason: `${checkout} is not a git checkout` }
  }

  const paths = filesInDiff(readFileSync(patchPath, 'utf8'))
  if (paths.length === 0) {
    return { ...base, reason: `${patchPath} contains no file diffs` }
  }

  const apply = (extra, path) =>
    git(checkout, ['apply', '--check', '--cached', ...extra, `--include=${path}`, patchPath])

  const files = paths.map((path) => {
    const forward = apply([], path)
    if (forward.status === 0) return { path, status: 'applies' }
    if (apply(['--reverse'], path).status === 0) return { path, status: 'already-applied' }
    const detail = forward.stderr.trim().split('\n')[0] || 'patch does not apply'
    return { path, status: 'conflict', detail }
  })

  const at = checkoutVersion(checkout)
  return {
    checked: true,
    checkoutPath: checkout,
    checkoutVersion: at,
    // The checkout sits on our base, so a clean result says the patches match
    // the tree we already have — not that they survive the rebase to upstream.
    checkedAgainstUpstream: at !== null && at === upstreamVersion,
    patchFile: PATCH_FILE,
    files,
    conflicts: files.filter((file) => file.status === 'conflict').length
  }
}

function parseArgs(argv) {
  const options = { json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--channel') options.channel = argv[++i]
    else if (arg === '--platform') options.platform = argv[++i]
    else if (arg === '--checkout') options.checkout = argv[++i]
    else throw new Error(`unknown option: ${arg} (try --help)`)
  }
  if (options.channel && !CHANNELS[options.channel]) {
    throw new Error(`unknown channel: ${options.channel} (expected stable, beta or dev)`)
  }
  return options
}

function patchLines(patches) {
  if (!patches.checked) return [`  patch set     not checked: ${patches.reason}`]

  const clean = patches.files.length - patches.conflicts
  const where = patches.checkoutVersion ?? 'an unknown version'
  const lines = [
    `  patch set     ${clean}/${patches.files.length} apply — ${patches.patchFile}`,
    `                checked against the checkout at ${where}`,
    ...(patches.checkedAgainstUpstream
      ? ['                — which is the upstream version above']
      : [
          '                — NOT the upstream version above, so a clean result',
          '                  here does not predict the rebase'
        ]),
    `                ${patches.checkoutPath}`
  ]
  for (const file of patches.files.filter((f) => f.status !== 'applies')) {
    lines.push(`                  ${file.status.padEnd(16)}${file.path}`)
  }
  return lines
}

function securityLines(security) {
  if (!security) return []
  if (!security.checked) return ['', `  security      not checked — ${security.reason}`]
  if (security.posts.length === 0)
    return ['', '  security      no stable-channel security announcements in the range']
  return [
    '',
    `  security      ${security.fixes} fix${security.fixes === 1 ? '' : 'es'} announced in ${security.posts.length} release${security.posts.length === 1 ? '' : 's'} since our pin` +
      (security.highest ? ` — highest severity ${security.highest}` : '')
  ]
}

function render(result) {
  const { pinned, upstream, delta, status } = result
  const released = upstream.released ? ` (released ${upstream.released.slice(0, 10)})` : ''
  const summary =
    status === 'behind'
      ? `BEHIND — rebase to ${upstream.version}` +
        (delta.milestones > 0
          ? ` (${delta.milestones} milestone${delta.milestones === 1 ? '' : 's'} ahead of us)`
          : ' (same milestone — a security/stable refresh)')
      : status === 'ahead'
        ? 'AHEAD of the channel (we track a newer build than this channel ships)'
        : 'UP TO DATE'

  return [
    `Arcwel WebDeck — upstream check (${result.channel} / ${result.platform})`,
    '',
    `  pinned base   ${pinned.version}   ${pinned.source}`,
    `  upstream      ${upstream.version}${released}`,
    `  status        ${summary}`,
    '',
    ...patchLines(result.patches),
    ...securityLines(result.security),
    ''
  ].join('\n')
}

// ── security fixes in the range ─────────────────────────────────────────────
// Chrome's release blog announces every stable update with the count of
// security fixes it carries and, for the ones disclosed, a severity per CVE.
// Between our pin and upstream, those are the fixes we are shipping without —
// the number that turns "behind" from a backlog item into a deadline.
const RELEASE_FEED =
  'https://chromereleases.googleblog.com/feeds/posts/default/-/Stable%20updates?alt=json&max-results=40'
const SEVERITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 }

/** Pure: the fixes and highest severity announced for versions in (pinned, upstream]. */
export function securityFromPosts(posts, pinnedVersion, upstreamVersion) {
  const ours = parseVersion(pinnedVersion)
  const theirs = parseVersion(upstreamVersion)
  const hits = []
  for (const post of posts) {
    // The desktop announcements carry the fixes; Android and iOS posts repeat
    // the version with none.
    if (/Android|iOS/i.test(String(post.title || ''))) continue
    const text = String(post.text || '')
    const versions = [...text.matchAll(/\b(\d+\.\d+\.\d+\.\d+)\b/g)].map((m) => m[1])
    const inRange = versions.some((v) => {
      const p = parseVersion(v)
      return p && ours && theirs && compareVersions(p, ours) > 0 && compareVersions(p, theirs) <= 0
    })
    if (!inRange) continue
    // "[$2,500][ 544163112 ] Critical CVE-2026-87464: …" — a reward (or N/A,
    // TBD) in the first bracket, a padded bug id in the second, then the
    // severity. The stated count ("includes N security fixes") is used when
    // present; the listed CVEs are the floor either way.
    const stated = /includes\s+(\d+)\s+security\s+fix/i.exec(text)
    const severities = [
      ...text.matchAll(/\[[^\]]*\]\s*\[\s*\d+\s*\]\s*(Critical|High|Medium|Low)\b/g)
    ].map((m) => m[1])
    const highest =
      severities.slice().sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ?? null
    hits.push({
      title: post.title,
      version: versions[0] ?? null,
      fixes: Math.max(stated ? Number(stated[1]) : 0, severities.length),
      highest
    })
  }
  const highest =
    hits
      .map((h) => h.highest)
      .filter(Boolean)
      .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ?? null
  return {
    checked: true,
    posts: hits,
    fixes: hits.reduce((n, h) => n + h.fixes, 0),
    highest
  }
}

async function fetchSecurity(pinnedVersion, upstreamVersion) {
  try {
    const feed = await fetchJson(RELEASE_FEED)
    const entries = feed?.feed?.entry ?? []
    const posts = entries.map((e) => ({
      title: e.title?.$t ?? '',
      text: String(e.content?.$t ?? e.summary?.$t ?? '').replace(/<[^>]+>/g, ' ')
    }))
    return securityFromPosts(posts, pinnedVersion, upstreamVersion)
  } catch (error) {
    return { checked: false, reason: `release blog unreachable: ${error.message}` }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return EXIT_OK
  }

  const pin = readPin()
  const channel = options.channel ?? (CHANNELS[pin.channel] ? pin.channel : 'stable')
  const platform = options.platform ?? pin.platform ?? 'Mac'
  const checkout = resolve(
    options.checkout ?? process.env.WEBDECK_CHROMIUM_SRC ?? pin.checkout ?? ''
  )

  const upstream = await fetchUpstream(channel, platform)
  const result = buildResult({
    channel,
    platform,
    pinned: { version: pin.base, source: 'chromium/fork.json' },
    upstream,
    patches: checkPatchSet(checkout, upstream.version),
    security:
      compareVersions(parseVersion(pin.base), parseVersion(upstream.version)) < 0
        ? await fetchSecurity(pin.base, upstream.version)
        : { checked: true, posts: [], fixes: 0, highest: null }
  })

  console.log(options.json ? JSON.stringify(result, null, 2) : render(result))
  return result.exitCode
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const json = process.argv.includes('--json')
  process.exitCode = await main().catch((error) => {
    console.error(`upstream-check: ${error.message}`)
    if (json)
      console.log(
        JSON.stringify({ ok: false, error: error.message, exitCode: EXIT_ERROR }, null, 2)
      )
    return EXIT_ERROR
  })
}
