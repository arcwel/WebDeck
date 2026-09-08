// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { setCoreEnv } from '../env'
import {
  channelOf,
  compareVersions,
  newestOnChannel,
  parseVersion,
  pickAsset
} from '@shared/updates'
import type { ParsedVersion, ReleaseInfo } from '@shared/updates'

const dir = join(tmpdir(), `wd-updates-${process.pid}`)
mkdirSync(dir, { recursive: true })
setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})
const updates = await import('./updates')

const release = (tag: string, extra: Partial<ReleaseInfo> = {}): ReleaseInfo => ({
  version: tag.replace(/^v/, ''),
  tag,
  url: `https://github.com/arcwel/WebDeck/releases/tag/${tag}`,
  publishedAt: '2026-09-08T00:00:00Z',
  notes: '',
  prerelease: false,
  asset: null,
  checksumUrl: null,
  ...extra
})

describe('versions and channels', () => {
  it('parses a tag with or without v, with a pre-release suffix', () => {
    expect(parseVersion('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, pre: [] })
    expect(parseVersion('0.2.0-rc.1')?.pre).toEqual(['rc', '1'])
    expect(parseVersion('nightly')).toBeNull()
  })

  it('orders versions the semver way: a release outranks its pre-releases', () => {
    const v = (t: string): ParsedVersion => parseVersion(t)!
    expect(compareVersions(v('0.2.0'), v('0.1.9'))).toBeGreaterThan(0)
    expect(compareVersions(v('0.2.0-rc.1'), v('0.2.0'))).toBeLessThan(0)
    expect(compareVersions(v('0.2.0-rc.2'), v('0.2.0-rc.10'))).toBeLessThan(0)
    expect(compareVersions(v('1.0.0'), v('1.0.0'))).toBe(0)
  })

  it('a stable build only hears about stable releases; a pre-release build hears both', () => {
    const feed = [
      release('v0.1.0'),
      release('v0.2.0-rc.1', { prerelease: true }),
      release('v0.1.5'),
      release('v0.3.0-beta.1', { prerelease: true })
    ]
    expect(channelOf('0.1.0')).toBe('stable')
    expect(newestOnChannel('0.1.0', feed)?.version).toBe('0.1.5')
    expect(channelOf('0.2.0-rc.1')).toBe('pre')
    expect(newestOnChannel('0.2.0-rc.1', feed)?.version).toBe('0.3.0-beta.1')
    expect(newestOnChannel('0.1.5', feed)).toBeNull()
    expect(newestOnChannel('garbage', feed)).toBeNull()
  })
})

describe('the checker', () => {
  const broadcasts: unknown[] = []
  beforeEach(() => {
    rmSync(join(dir, 'update-check.json'), { force: true })
    broadcasts.length = 0
    process.env.WEBDECK_VERSION = '0.1.0'
    updates.setUpdateBroadcaster((s) => broadcasts.push(s))
  })
  afterEach(() => {
    updates.setUpdateBroadcaster(null)
    updates.stopUpdateChecks()
    delete process.env.WEBDECK_VERSION
    vi.useRealTimers()
  })

  const feed = (body: unknown, status = 200): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('finds the newest release on the channel, skips drafts, remembers it, and says so', async () => {
    updates.setUpdateFetch(
      feed([
        { tag_name: 'v0.4.0', draft: true, html_url: 'x' },
        { tag_name: 'v0.2.0', prerelease: false, html_url: 'https://r/0.2.0', body: 'Notes' },
        { tag_name: 'v0.3.0-rc.1', prerelease: true, html_url: 'https://r/rc' },
        { tag_name: 'not-a-version' }
      ])
    )
    const status = await updates.checkForUpdates()
    expect(status.available?.version).toBe('0.2.0')
    expect(status.available?.url).toBe('https://r/0.2.0')
    expect(status.error).toBeNull()
    expect(status.checkedAt).not.toBeNull()
    expect(updates.updateStatus().available?.version).toBe('0.2.0')
    // A "checking" broadcast, then the answer.
    expect(broadcasts.length).toBe(2)
  })

  it('keeps the last good answer and records why when the feed fails', async () => {
    updates.setUpdateFetch(feed([{ tag_name: 'v0.2.0', html_url: 'u' }]))
    await updates.checkForUpdates()
    updates.setUpdateFetch(feed({ message: 'rate limited' }, 403))
    const status = await updates.checkForUpdates()
    expect(status.available?.version).toBe('0.2.0')
    expect(status.error).toMatch(/403/)
  })

  it('not now keeps the version down until a newer one appears', async () => {
    updates.setUpdateFetch(feed([{ tag_name: 'v0.2.0', html_url: 'u' }]))
    await updates.checkForUpdates()
    expect(updates.dismissUpdate('0.2.0').dismissed).toBe('0.2.0')
    updates.setUpdateFetch(feed([{ tag_name: 'v0.2.1', html_url: 'u' }]))
    const status = await updates.checkForUpdates()
    expect(status.available?.version).toBe('0.2.1')
    expect(status.dismissed).toBe('0.2.0')
  })

  it('checks shortly after launch and then every 24 hours', async () => {
    vi.useFakeTimers()
    let calls = 0
    updates.setUpdateFetch((async () => {
      calls++
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch)
    const stop = updates.startUpdateChecks()
    expect(calls).toBe(0)
    await vi.advanceTimersByTimeAsync(updates.LAUNCH_DELAY_MS)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(updates.CHECK_INTERVAL_MS)
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(updates.CHECK_INTERVAL_MS)
    expect(calls).toBe(3)
    stop()
    await vi.advanceTimersByTimeAsync(updates.CHECK_INTERVAL_MS * 2)
    expect(calls).toBe(3)
  })

  it('the schedule can be turned off for a run', async () => {
    vi.useFakeTimers()
    process.env.WEBDECK_UPDATE_CHECK = 'off'
    let calls = 0
    updates.setUpdateFetch((async () => {
      calls++
      return new Response('[]')
    }) as unknown as typeof fetch)
    updates.startUpdateChecks()
    await vi.advanceTimersByTimeAsync(updates.CHECK_INTERVAL_MS * 2)
    expect(calls).toBe(0)
    delete process.env.WEBDECK_UPDATE_CHECK
  })
})

describe('the build for this machine', () => {
  const a = (name: string): { name: string; url: string; size: number } => ({
    name,
    url: `https://dl/${name}`,
    size: 1
  })
  it('prefers a zip over a dmg, and one that names the architecture', () => {
    const assets = [
      a('SHA256SUMS'),
      a('Arcwel-WebDeck-0.2.0-arm64.dmg'),
      a('Arcwel-WebDeck-0.2.0-arm64.zip'),
      a('notes.txt')
    ]
    expect(pickAsset(assets, 'darwin', 'arm64')?.name).toBe('Arcwel-WebDeck-0.2.0-arm64.zip')
    expect(pickAsset([a('Arcwel-WebDeck-0.2.0-arm64.dmg')], 'darwin', 'arm64')?.name).toMatch(
      /dmg$/
    )
  })
  it('refuses the other architecture, anything that is not a build, and other platforms', () => {
    expect(pickAsset([a('Arcwel-WebDeck-x86_64.zip')], 'darwin', 'arm64')).toBeNull()
    expect(pickAsset([a('SHA256SUMS'), a('source.tar.gz')], 'darwin', 'arm64')).toBeNull()
    expect(pickAsset([a('Arcwel-WebDeck-arm64.zip')], 'linux', 'arm64')).toBeNull()
  })
})

describe('Update now', () => {
  let server: Server
  let base = ''
  const files = new Map<string, Buffer>()
  const broadcasts: unknown[] = []
  const home = join(dir, 'home')

  beforeAll(async () => {
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    setCoreEnv({
      userDataDir: dir,
      homeDir: home,
      appDir: dir,
      secrets: {
        isAvailable: () => false,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString()
      }
    })
    server = createServer((req, res) => {
      const body = files.get(req.url ?? '')
      if (!body) {
        res.statusCode = 404
        return res.end()
      }
      res.setHeader('content-length', String(body.length))
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address() as { port: number }
    base = `http://127.0.0.1:${addr.port}`
  })
  afterAll(() => server.close())
  beforeEach(() => {
    rmSync(join(dir, 'update-check.json'), { force: true })
    rmSync(join(home, 'Downloads'), { recursive: true, force: true })
    mkdirSync(join(home, 'Downloads'), { recursive: true })
    broadcasts.length = 0
    process.env.WEBDECK_VERSION = '0.1.0'
    updates.resetDownloadForTests()
    updates.setUpdateBroadcaster((s) => broadcasts.push(s))
    updates.setUpdateFetch(fetch)
  })
  afterEach(() => {
    updates.setUpdateBroadcaster(null)
    updates.resetDownloadForTests()
    delete process.env.WEBDECK_VERSION
  })

  /** A release whose feed answers from the local server, with `assets`. */
  const publish = (assets: Array<{ name: string; body: Buffer }>, extra: string[] = []): void => {
    files.clear()
    for (const { name, body } of assets) files.set(`/${name}`, body)
    const sums =
      assets
        .map(({ name, body }) => `${createHash('sha256').update(body).digest('hex')}  ${name}`)
        .join('\n') + '\n'
    files.set('/SHA256SUMS', Buffer.from(sums))
    const list = [
      ...assets.map(({ name, body }) => ({
        name,
        browser_download_url: `${base}/${name}`,
        size: body.length
      })),
      { name: 'SHA256SUMS', browser_download_url: `${base}/SHA256SUMS`, size: sums.length },
      ...extra.map((name) => ({ name, browser_download_url: `${base}/${name}`, size: 0 }))
    ]
    files.set(
      '/feed',
      Buffer.from(JSON.stringify([{ tag_name: 'v0.2.0', html_url: 'https://r', assets: list }]))
    )
    process.env.WEBDECK_UPDATE_FEED = `${base}/feed`
  }
  const zipOf = (appName: string): Buffer => {
    const work = join(dir, 'zipwork')
    rmSync(work, { recursive: true, force: true })
    mkdirSync(join(work, appName, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(work, appName, 'Contents', 'MacOS', 'bin'), 'hello')
    execFileSync('/usr/bin/ditto', [
      '-c',
      '-k',
      '--keepParent',
      join(work, appName),
      join(work, 'a.zip')
    ])
    return readFileSync(join(work, 'a.zip'))
  }
  const mac = process.platform === 'darwin'

  it.skipIf(!mac)(
    'downloads the build for this machine, checks its digest, unpacks it and reveals the app',
    async () => {
      const zip = zipOf('Fake WebDeck.app')
      publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.zip', body: zip }])
      const checked = await updates.checkForUpdates()
      expect(checked.available?.asset?.name).toBe('Arcwel-WebDeck-0.2.0-arm64.zip')
      expect(checked.available?.checksumUrl).toBe(`${base}/SHA256SUMS`)
      const status = await updates.downloadUpdate()
      expect(status.download?.phase).toBe('done')
      expect(status.download?.received).toBe(zip.length)
      expect(status.download?.path).toBe(
        join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64', 'Fake WebDeck.app')
      )
      expect(existsSync(join(status.download!.path!, 'Contents', 'MacOS', 'bin'))).toBe(true)
      // Verified bytes carry no quarantine flag, whatever the zip held.
      expect(execFileSync('/usr/bin/xattr', ['-l', status.download!.path!]).toString()).not.toMatch(
        /quarantine/
      )
      expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.zip'))).toBe(true)
      const phases = (broadcasts as Array<{ download: { phase: string } | null }>)
        .map((b) => b.download?.phase)
        .filter(Boolean)
      expect(phases[0]).toBe('downloading')
      expect(phases.at(-1)).toBe('done')
    }
  )

  it('refuses a download whose bytes do not match the published checksum, and cleans up', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }])
    files.set('/SHA256SUMS', Buffer.from(`${'0'.repeat(64)}  Arcwel-WebDeck-0.2.0-arm64.dmg\n`))
    await updates.checkForUpdates()
    const status = await updates.downloadUpdate()
    expect(status.download?.phase).toBe('error')
    expect(status.download?.error).toMatch(/checksum/)
    expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.dmg'))).toBe(false)
    expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.dmg.part'))).toBe(false)
  })

  it('refuses a download that stops short of its declared size', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }])
    const feed = JSON.parse(files.get('/feed')!.toString()) as Array<{
      assets: Array<{ name: string; size: number }>
    }>
    feed[0].assets[0].size = 999
    files.set('/feed', Buffer.from(JSON.stringify(feed)))
    await updates.checkForUpdates()
    const status = await updates.downloadUpdate()
    expect(status.download?.phase).toBe('error')
    expect(status.download?.error).toMatch(/stopped at 7 of 999/)
  })

  it('says so when the release has no build for this machine', async () => {
    publish([], ['source.tar.gz'])
    const checked = await updates.checkForUpdates()
    expect(checked.available?.asset).toBeNull()
    await expect(updates.downloadUpdate()).rejects.toThrow(/no build to download/)
  })
})
