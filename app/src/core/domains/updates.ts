import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import {
  channelOf,
  newestOnChannel,
  parseVersion,
  pickAsset,
  type DownloadState,
  type ReleaseAsset,
  type ReleaseInfo,
  type UpdateStatus
} from '@shared/updates'
import { core } from '../rpc'
import { coreEnv } from '../env'
import { asString } from '../coerce'
import { JsonStore } from './json-store'
import { appVersion } from '../version'

/**
 * The release checker, and the download behind "Update now".
 *
 * Checking: asks the repository's releases on launch and once a day, keeps to
 * this build's channel, remembers what it found, and tells every window when
 * the answer changes so the title bar can show "Update".
 *
 * Downloading: fetches the release's build for this machine into Downloads,
 * checks its size and — when the release publishes one — its SHA-256, unpacks
 * a zip beside itself, and reveals the app in Finder. Installing stays the
 * person's move: drag it to Applications and relaunch. Nothing here replaces
 * the running app.
 *
 * The feed is GitHub's releases API for this repository; WEBDECK_UPDATE_FEED
 * points a test or a staged build at another URL with the same shape.
 * WEBDECK_UPDATE_CHECK=off turns the schedule off (the manual check still
 * works).
 */

export const DEFAULT_FEED = 'https://api.github.com/repos/arcwel/WebDeck/releases?per_page=30'
/** How long after boot the first check runs — after the shell has settled. */
export const LAUNCH_DELAY_MS = 15_000
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const NOTES_CAP = 2000
/** Progress is pushed at most this often, so a fast link does not flood the shell. */
const PROGRESS_EVERY_MS = 200
/** No bytes for this long and the transfer is given up as stalled, rather than
 *  sitting at "Downloading…" for as long as the socket stays open. */
let stallMs = 60_000
/** The checksum file is tiny; a fetch of it that takes longer than this is not
 *  going to finish. */
const CHECKSUM_TIMEOUT_MS = 30_000
/** The archive is written through a buffer this big, so a fast link is not
 *  paced by a 16 KB stream buffer draining thousands of times. */
const WRITE_BUFFER_BYTES = 4 * 1024 * 1024

interface Stored {
  checkedAt?: string
  available?: ReleaseInfo | null
  dismissed?: string
  error?: string | null
}

const store = new JsonStore<Stored>('update-check', {})
let broadcaster: ((status: UpdateStatus) => void) | null = null
let inFlight: Promise<UpdateStatus> | null = null
let fetchImpl: typeof fetch = fetch
let download: DownloadState | null = null
let downloadAbort: AbortController | null = null

export function setUpdateBroadcaster(fn: ((status: UpdateStatus) => void) | null): void {
  broadcaster = fn
}

/** Tests hand in their own fetch; the app uses Node's. */
export function setUpdateFetch(fn: typeof fetch): void {
  fetchImpl = fn
}

/** Tests shorten the stall watchdog. */
export function setDownloadStallMs(ms: number): void {
  stallMs = ms
}

function feedUrl(): string {
  return process.env.WEBDECK_UPDATE_FEED || DEFAULT_FEED
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
    download
  }
}

function announce(): void {
  broadcaster?.(updateStatus())
}

/** One GitHub release object, reduced to what the shell shows and downloads. */
function toRelease(raw: unknown): ReleaseInfo | null {
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
  const asset = pickAsset(assets, process.platform, process.arch)
  const checksum = asset
    ? (assets.find((a) => a.name === `${asset.name}.sha256`) ??
      assets.find((a) => /^sha256sums(\.txt)?$/i.test(a.name)))
    : undefined
  return {
    version: tag.replace(/^v/, ''),
    tag,
    url: typeof r.html_url === 'string' ? r.html_url : '',
    publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
    notes: notes.length > NOTES_CAP ? `${notes.slice(0, NOTES_CAP)}…` : notes,
    prerelease: r.prerelease === true,
    asset,
    checksumUrl: checksum?.url ?? null
  }
}

async function fetchReleases(): Promise<ReleaseInfo[]> {
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
  return body.map(toRelease).filter((r): r is ReleaseInfo => r !== null)
}

/**
 * Ask the feed now. Concurrent calls share one request. A failed check keeps
 * the last good answer and records why; nothing is shown for a failure
 * beyond the reason under Settings → Application → About.
 */
export function checkForUpdates(): Promise<UpdateStatus> {
  if (inFlight) return inFlight
  const before = updateStatus()
  inFlight = (async () => {
    let next: Stored
    try {
      const releases = await fetchReleases()
      const available = newestOnChannel(appVersion(), releases)
      next = { ...store.read(), checkedAt: new Date().toISOString(), available, error: null }
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

/** The published digest for `name`, from a SHA256SUMS or a .sha256 file. */
async function publishedDigest(
  url: string,
  name: string,
  signal: AbortSignal
): Promise<string | null> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(CHECKSUM_TIMEOUT_MS)])
  })
  if (!response.ok) throw new Error(`the checksum file answered ${response.status}`)
  const text = await response.text()
  for (const line of text.split('\n')) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim())
    if (!m) continue
    if (basename(m[2].trim()) === name) return m[1].toLowerCase()
  }
  // A bare digest, as `shasum` writes for one file.
  const bare = /^([0-9a-fA-F]{64})$/.exec(text.trim())
  return bare ? bare[1].toLowerCase() : null
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
  // against the release's published digest; that is the vouching. Without
  // this, a build the updater verified would still be refused on launch.
  await runTool('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', path]).catch(() => {})
  return path
}

/**
 * Fetch the available release's build for this machine. Runs once at a time;
 * progress goes out through the status broadcast. A verified archive is
 * unpacked (zip) and revealed in Finder; anything that goes wrong deletes the
 * partial file and says why.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  const status = updateStatus()
  const release = status.available
  if (!release?.asset)
    throw new Error('This release has no build to download; use the release page.')
  if (download && download.phase !== 'done' && download.phase !== 'error') return status
  const asset = release.asset
  const abort = new AbortController()
  downloadAbort = abort
  // The watchdog: reset on every chunk, fired when the link goes quiet.
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
    if (release.checksumUrl) {
      const want = await publishedDigest(release.checksumUrl, asset.name, abort.signal)
      const got = hash.digest('hex')
      if (want && want !== got) throw new Error('the download did not match its published checksum')
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
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    download = {
      ...download,
      phase: 'error',
      error: stalled
        ? `The download stalled: nothing arrived for ${Math.round(stallMs / 1000)} seconds.`
        : abort.signal.aborted
          ? 'Download cancelled.'
          : timedOut
            ? 'The checksum file took too long to answer.'
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
  core.register(IpcChannels.updatesDownload, () => downloadUpdate())
  core.register(IpcChannels.updatesCancelDownload, () => cancelDownload())
  core.register(IpcChannels.updatesReveal, () => revealDownload())
}
