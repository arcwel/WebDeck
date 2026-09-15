import { createHash, createPublicKey, randomUUID, verify as cryptoVerify } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import {
  channelOf,
  compareVersions,
  newestOnChannel,
  parseVersion,
  pickAsset,
  type DownloadState,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateStatus
} from '@shared/updates'
import {
  canonicalize,
  parseSignedManifest,
  rolloutBucket,
  type SignedManifest
} from '@shared/update-signing'
import { core } from '../rpc'
import { coreEnv } from '../env'
import { asString } from '../coerce'
import { JsonStore } from './json-store'
import { appVersion, chromiumVersion, updatePublicKey } from '../version'

/**
 * The release checker, and the download behind "Update now".
 *
 * Checking: asks the repository's releases on launch and once a day, keeps to
 * this build's channel, remembers what it found, and tells every window when
 * the answer changes so the title bar can show "Update".
 *
 * Trust: a release publishes `update.json`, a manifest naming its assets and
 * their digests, signed with the Ed25519 key whose public half is pinned in
 * this build. Only a release whose manifest verifies is downloaded in-app; any
 * other release is shown with its page and nothing more. The manifest also
 * says which Chromium the release was built on (newer than ours means it
 * carries upstream security fixes, and the chip says so) and what share of
 * installs it is offered to (a staged rollout; this install has a stable
 * bucket per version).
 *
 * Downloading: fetches the build for this machine into Downloads, checks its
 * size and its signed digest, unpacks a zip beside itself, clears the
 * quarantine flag the browser's processes add to every file they write, and
 * reveals the app in Finder. Installing stays the person's move. The previous
 * release on the channel is offered the same way, for going back.
 *
 * WEBDECK_UPDATE_FEED points a test or a staged build at another feed with
 * GitHub's shape; WEBDECK_UPDATE_CHECK=off turns the schedule off.
 */

export const DEFAULT_FEED = 'https://api.github.com/repos/arcwel/WebDeck/releases?per_page=30'
/** How long after boot the first check runs — after the shell has settled. */
export const LAUNCH_DELAY_MS = 15_000
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const NOTES_CAP = 2000
/** The asset a release publishes its signed manifest as. */
export const MANIFEST_ASSET = 'update.json'
/** Progress is pushed at most this often, so a fast link does not flood the shell. */
const PROGRESS_EVERY_MS = 200
/** No bytes for this long and the transfer is given up as stalled. */
let stallMs = 60_000
/** The archive is written through a buffer this big. */
const WRITE_BUFFER_BYTES = 4 * 1024 * 1024

interface Stored {
  installId?: string
  checkedAt?: string
  available?: ReleaseInfo | null
  previous?: ReleaseInfo | null
  staged?: { version: string; rollout: number } | null
  dismissed?: string
  error?: string | null
}

const store = new JsonStore<Stored>('update-check', {})
let broadcaster: ((status: UpdateStatus) => void) | null = null
let inFlight: Promise<UpdateStatus> | null = null
let fetchImpl: typeof fetch = fetch
let publicKeyOverride: string | null = null
let download: DownloadState | null = null
let downloadAbort: AbortController | null = null

export function setUpdateBroadcaster(fn: ((status: UpdateStatus) => void) | null): void {
  broadcaster = fn
}

/** Tests hand in their own fetch; the app uses Node's. */
export function setUpdateFetch(fn: typeof fetch): void {
  fetchImpl = fn
}

/** Tests pin their own key; null goes back to the build's. */
export function setUpdatePublicKey(pem: string | null): void {
  publicKeyOverride = pem
}

/** Tests shorten the stall watchdog. */
export function setDownloadStallMs(ms: number): void {
  stallMs = ms
}

/** Which build a release offers this machine: the running platform, or what a test says. */
let updatePlatform: { platform: string; arch: string } = {
  platform: process.platform,
  arch: process.arch
}

/** Tests pin the platform, so the fixtures mean the same on every CI runner. */
export function setUpdatePlatform(platform: { platform: string; arch: string } | null): void {
  updatePlatform = platform ?? { platform: process.platform, arch: process.arch }
}

function feedUrl(): string {
  return process.env.WEBDECK_UPDATE_FEED || DEFAULT_FEED
}

function pinnedKey(): string {
  return publicKeyOverride ?? updatePublicKey()
}

/** A stable id for this install, minted once; it decides rollout buckets. */
function installId(): string {
  const saved = store.read()
  if (saved.installId) return saved.installId
  const id = randomUUID()
  store.write({ ...saved, installId: id })
  return id
}

export function updateStatus(): UpdateStatus {
  const saved = store.read()
  const current = appVersion()
  return {
    current,
    channel: channelOf(current),
    checkedAt: saved.checkedAt ?? null,
    available: saved.available ?? null,
    dismissed: saved.dismissed ?? null,
    error: saved.error ?? null,
    checking: inFlight !== null,
    download,
    staged: saved.staged ?? null,
    previous: saved.previous ?? null
  }
}

function announce(): void {
  broadcaster?.(updateStatus())
}

/** A release as the feed lists it, before its manifest is looked at. */
interface ListedRelease {
  info: ReleaseInfo
  manifestUrl: string | null
}

/** One GitHub release object, reduced to what the shell shows and downloads. */
function toListed(raw: unknown): ListedRelease | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.draft === true) return null
  const tag = typeof r.tag_name === 'string' ? r.tag_name : ''
  const parsed = parseVersion(tag)
  if (!parsed) return null
  const notes = typeof r.body === 'string' ? r.body : ''
  const assets: ReleaseAsset[] = Array.isArray(r.assets)
    ? (r.assets as unknown[]).flatMap((a) => {
        if (!a || typeof a !== 'object') return []
        const x = a as Record<string, unknown>
        if (typeof x.name !== 'string' || typeof x.browser_download_url !== 'string') return []
        return [
          {
            name: x.name,
            url: x.browser_download_url,
            size: typeof x.size === 'number' ? x.size : 0
          }
        ]
      })
    : []
  const manifest = assets.find((a) => a.name === MANIFEST_ASSET)
  return {
    info: {
      version: tag.replace(/^v/, ''),
      tag,
      url: typeof r.html_url === 'string' ? r.html_url : '',
      publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
      notes: notes.length > NOTES_CAP ? `${notes.slice(0, NOTES_CAP)}…` : notes,
      prerelease: r.prerelease === true,
      asset: pickAsset(assets, updatePlatform.platform, updatePlatform.arch),
      signed: false,
      unsignedReason: manifest
        ? 'manifest not checked'
        : 'the release publishes no signed manifest',
      sha256: null,
      chromium: null,
      security: false,
      rollout: 100
    },
    manifestUrl: manifest?.url ?? null
  }
}

async function fetchReleases(): Promise<ListedRelease[]> {
  const response = await fetchImpl(feedUrl(), {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': `WebDeck/${appVersion()}`
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`the release feed answered ${response.status}`)
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) throw new Error('the release feed did not answer with a list')
  return body.map(toListed).filter((r): r is ListedRelease => r !== null)
}

/** Ed25519 over the canonical manifest, against the pinned key. Fails closed. */
export function verifySignedManifest(
  signed: SignedManifest,
  publicKeyPem: string
): { ok: true } | { ok: false; reason: string } {
  try {
    if (!publicKeyPem) return { ok: false, reason: 'no update key is pinned in this build' }
    const key = createPublicKey(publicKeyPem)
    const ok = cryptoVerify(
      null,
      Buffer.from(canonicalize(signed.manifest), 'utf8'),
      key,
      Buffer.from(signed.signature, 'base64')
    )
    return ok
      ? { ok: true }
      : { ok: false, reason: 'the manifest signature does not match the pinned key' }
  } catch (error) {
    return {
      ok: false,
      reason: `the manifest could not be verified: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** Is `candidate` a newer Chromium than the one this build runs? Chromium
 *  versions are four dotted numbers (153.0.8010.12), not semver. */
function newerChromium(candidate: string, running: string): boolean {
  const a = candidate.trim().split('.').map(Number)
  const b = running.trim().split('.').map(Number)
  if (a.length === 0 || b.length === 0 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/**
 * Fetch and verify a release's manifest, and fold what it says into the
 * release: signed or not (and why), the asset's digest, the Chromium base and
 * the security flag, the rollout share. Never throws: a manifest that cannot
 * be fetched leaves the release unsigned with the reason.
 */
async function resolveRelease(listed: ListedRelease): Promise<ReleaseInfo> {
  const { info, manifestUrl } = listed
  if (!manifestUrl) return info
  try {
    const response = await fetchImpl(manifestUrl, {
      headers: { 'user-agent': `WebDeck/${appVersion()}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) return { ...info, unsignedReason: `the manifest answered ${response.status}` }
    const signed = parseSignedManifest(await response.json())
    if (!signed) return { ...info, unsignedReason: 'the manifest is malformed' }
    const verdict = verifySignedManifest(signed, pinnedKey())
    if (!verdict.ok) return { ...info, unsignedReason: verdict.reason }
    const m = signed.manifest
    if (m.version !== info.version) {
      return { ...info, unsignedReason: `the manifest is for ${m.version}, not ${info.version}` }
    }
    const named = info.asset ? m.assets.find((a) => a.name === info.asset?.name) : undefined
    const chromium = m.chromium || null
    const security = m.critical || (chromium !== null && newerChromium(chromium, chromiumVersion()))
    if (!named) {
      return {
        ...info,
        chromium,
        security,
        rollout: m.rollout,
        unsignedReason: info.asset
          ? `the manifest does not name ${info.asset.name}`
          : 'the release has no build for this machine'
      }
    }
    return {
      ...info,
      signed: true,
      unsignedReason: null,
      sha256: named.sha256,
      chromium,
      security,
      rollout: m.rollout
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ...info, unsignedReason: `the manifest could not be fetched: ${reason}` }
  }
}

/** The newest release on the channel below `current`: where "go back" leads. */
function previousOnChannel(
  current: string,
  releases: ReadonlyArray<ReleaseInfo>
): ReleaseInfo | null {
  const mine = parseVersion(current)
  if (!mine) return null
  const stableOnly = channelOf(current) === 'stable'
  let best: { release: ReleaseInfo; parsed: NonNullable<ReturnType<typeof parseVersion>> } | null =
    null
  for (const release of releases) {
    if (stableOnly && release.prerelease) continue
    const parsed = parseVersion(release.version)
    if (!parsed || compareVersions(parsed, mine) >= 0) continue
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { release, parsed }
  }
  return best?.release ?? null
}

/**
 * Ask the feed now. Concurrent calls share one request. A failed check keeps
 * the last good answer and records why.
 */
export function checkForUpdates(): Promise<UpdateStatus> {
  if (inFlight) return inFlight
  const before = updateStatus()
  inFlight = (async () => {
    let next: Stored
    try {
      const listed = await fetchReleases()
      const infos = listed.map((l) => l.info)
      const current = appVersion()
      // The install id is minted on the first check, so it is stable from the
      // first staged release on.
      const id = installId()
      const newest = newestOnChannel(current, infos)
      const older = previousOnChannel(current, infos)
      const resolve = async (info: ReleaseInfo | null): Promise<ReleaseInfo | null> => {
        if (!info) return null
        const entry = listed.find((l) => l.info.version === info.version)
        return entry ? resolveRelease(entry) : info
      }
      const candidate = await resolve(newest)
      const previous = await resolve(older)
      let available: ReleaseInfo | null = candidate
      let staged: Stored['staged'] = null
      if (candidate && candidate.rollout < 100) {
        const bucket = rolloutBucket(id, candidate.version)
        if (bucket >= candidate.rollout) {
          available = null
          staged = { version: candidate.version, rollout: candidate.rollout }
        }
      }
      next = {
        ...store.read(),
        checkedAt: new Date().toISOString(),
        available,
        previous,
        staged,
        error: null
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'the release feed took too long to answer'
          : reason
      next = { ...store.read(), checkedAt: new Date().toISOString(), error: message }
    }
    store.write(next)
    inFlight = null
    const after = updateStatus()
    if (
      before.available?.version !== after.available?.version ||
      before.error !== after.error ||
      before.checkedAt !== after.checkedAt
    ) {
      broadcaster?.(after)
    }
    return after
  })()
  broadcaster?.({ ...before, checking: true })
  return inFlight
}

/** "Not now" for this version: the chip stays down until a newer one appears. */
export function dismissUpdate(version: string): UpdateStatus {
  store.write({ ...store.read(), dismissed: version })
  const status = updateStatus()
  broadcaster?.(status)
  return status
}

/* ---- the download ---- */

/** Where the build lands: the user's Downloads, or home when there is none. */
function downloadsDir(): string {
  const home = coreEnv().homeDir
  const downloads = join(home, 'Downloads')
  return existsSync(downloads) ? downloads : home
}

/** A path that does not exist yet: name, name (2), name (3)… */
function freePath(dir: string, name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let candidate = join(dir, name)
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

function setDownload(patch: Partial<DownloadState>): void {
  if (!download) return
  download = { ...download, ...patch }
  announce()
}

function runTool(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${basename(cmd)} exited ${code}: ${err.trim()}`))
    )
  })
}

/** Unpack a zip beside itself and return the .app inside, or the folder. */
async function unpack(zipPath: string): Promise<string> {
  const dir = zipPath.replace(/\.zip$/i, '')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // ditto keeps the signature's extended attributes; unzip does not.
  await runTool('/usr/bin/ditto', ['-x', '-k', zipPath, dir])
  const app = readdirSync(dir).find((n) => n.endsWith('.app'))
  const path = app ? join(dir, app) : dir
  // The browser's Info.plist asks the kernel to quarantine every file its
  // processes create — this core included — so the archive and everything
  // unpacked from it carry the flag that asks Gatekeeper to distrust a
  // download until a person vouches for it. The bytes were just checked
  // against the release's signed digest; that is the vouching.
  await runTool('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', path]).catch(() => {})
  return path
}

/** The release a download request names: the available one, or the previous. */
function releaseToDownload(version: string | undefined): ReleaseInfo | null {
  const status = updateStatus()
  if (!version) return status.available
  if (status.available?.version === version) return status.available
  if (status.previous?.version === version) return status.previous
  return null
}

/**
 * Fetch a release's build for this machine. Only a signed release is fetched:
 * its manifest names the digest the bytes must match. Runs once at a time;
 * progress goes out through the status broadcast. A verified archive is
 * unpacked (zip) and revealed in Finder; anything that goes wrong deletes the
 * partial file and says why.
 */
export async function downloadUpdate(version?: string): Promise<UpdateStatus> {
  const release = releaseToDownload(version)
  if (!release) throw new Error('That release is not on offer.')
  if (!release.asset)
    throw new Error('This release has no build to download; use the release page.')
  if (!release.signed || !release.sha256) {
    throw new Error(
      `This release is not signed for in-app update (${release.unsignedReason ?? 'no signed manifest'}); use the release page.`
    )
  }
  if (download && download.phase !== 'done' && download.phase !== 'error') return updateStatus()
  const asset = release.asset
  const abort = new AbortController()
  downloadAbort = abort
  let stalled = false
  let watchdog: NodeJS.Timeout | null = null
  const armWatchdog = (): void => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      abort.abort()
    }, stallMs)
  }
  download = {
    version: release.version,
    phase: 'downloading',
    received: 0,
    total: asset.size,
    path: null,
    error: null
  }
  announce()
  const dir = downloadsDir()
  const finalPath = freePath(dir, asset.name)
  const partPath = `${finalPath}.part`
  try {
    const response = await fetchImpl(asset.url, {
      headers: { 'user-agent': `WebDeck/${appVersion()}` },
      signal: abort.signal
    })
    if (!response.ok || !response.body) throw new Error(`the download answered ${response.status}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > 0 && download.total === 0) setDownload({ total: declared })
    const hash = createHash('sha256')
    const out = createWriteStream(partPath, { highWaterMark: WRITE_BUFFER_BYTES })
    const reader = response.body.getReader()
    let received = 0
    let lastPush = 0
    armWatchdog()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      armWatchdog()
      hash.update(value)
      received += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', r))
      const now = Date.now()
      if (now - lastPush > PROGRESS_EVERY_MS) {
        lastPush = now
        setDownload({ received })
      }
    }
    if (watchdog) clearTimeout(watchdog)
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.end(resolve)
    })
    setDownload({ received, phase: 'verifying' })
    const expected = asset.size || declared
    if (expected > 0 && received !== expected) {
      throw new Error(`the download stopped at ${received} of ${expected} bytes`)
    }
    if (hash.digest('hex') !== release.sha256) {
      throw new Error('the download did not match the digest in the signed manifest')
    }
    renameSync(partPath, finalPath)
    let path = finalPath
    if (/\.zip$/i.test(finalPath) && process.platform === 'darwin') {
      setDownload({ phase: 'unpacking' })
      path = await unpack(finalPath)
    }
    download = { ...download, phase: 'done', received, path, error: null }
    announce()
    if (process.platform === 'darwin') void runTool('/usr/bin/open', ['-R', path]).catch(() => {})
  } catch (error) {
    rmSync(partPath, { force: true })
    const reason = error instanceof Error ? error.message : String(error)
    download = {
      ...download,
      phase: 'error',
      error: stalled
        ? `The download stalled: nothing arrived for ${Math.round(stallMs / 1000)} seconds.`
        : abort.signal.aborted
          ? 'Download cancelled.'
          : reason
    }
    announce()
  } finally {
    if (watchdog) clearTimeout(watchdog)
    downloadAbort = null
  }
  return updateStatus()
}

export function cancelDownload(): UpdateStatus {
  downloadAbort?.abort()
  return updateStatus()
}

/** Show the downloaded build in Finder again. */
export async function revealDownload(): Promise<UpdateStatus> {
  const path = download?.phase === 'done' ? download.path : null
  if (path && existsSync(path) && process.platform === 'darwin') {
    await runTool('/usr/bin/open', ['-R', path]).catch(() => {})
  } else if (download?.phase === 'done') {
    download = {
      ...download,
      phase: 'error',
      error: 'The downloaded build is no longer where it was.'
    }
    announce()
  }
  return updateStatus()
}

/** Tests: forget the download between cases. */
export function resetDownloadForTests(): void {
  downloadAbort?.abort()
  download = null
  downloadAbort = null
}

/* ---- the schedule ---- */

let launchTimer: NodeJS.Timeout | null = null
let dailyTimer: NodeJS.Timeout | null = null

/**
 * The schedule: one check shortly after launch, then one every 24 hours for
 * as long as the core runs. Both timers are unref'd so they never keep the
 * process alive. Returns the stop function.
 */
export function startUpdateChecks(
  options: { launchDelayMs?: number; intervalMs?: number } = {}
): () => void {
  stopUpdateChecks()
  if (process.env.WEBDECK_UPDATE_CHECK === 'off') return stopUpdateChecks
  const launchDelay = options.launchDelayMs ?? LAUNCH_DELAY_MS
  const interval = options.intervalMs ?? CHECK_INTERVAL_MS
  const run = (): void => void checkForUpdates().catch(() => {})
  launchTimer = setTimeout(run, launchDelay)
  launchTimer.unref()
  dailyTimer = setInterval(run, interval)
  dailyTimer.unref()
  return stopUpdateChecks
}

export function stopUpdateChecks(): void {
  if (launchTimer) clearTimeout(launchTimer)
  if (dailyTimer) clearInterval(dailyTimer)
  launchTimer = null
  dailyTimer = null
}

export function registerUpdatesRpc(): void {
  core.register(IpcChannels.updatesStatus, () => updateStatus())
  core.register(IpcChannels.updatesCheck, () => checkForUpdates())
  core.register(IpcChannels.updatesDismiss, (version) => dismissUpdate(asString(version) ?? ''))
  core.register(IpcChannels.updatesDownload, (version) =>
    downloadUpdate(asString(version) ?? undefined)
  )
  core.register(IpcChannels.updatesCancelDownload, () => cancelDownload())
  core.register(IpcChannels.updatesReveal, () => revealDownload())
}
