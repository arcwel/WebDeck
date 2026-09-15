// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
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
import { canonicalize, rolloutBucket } from '@shared/update-signing'

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
  signed: false,
  unsignedReason: 'test fixture',
  sha256: null,
  chromium: null,
  security: false,
  rollout: 100,
  ...extra
})

// The fixtures name Apple Silicon builds. On a Linux CI runner the pick would
// find nothing and every download test would fail for the wrong reason, so
// the whole file runs as darwin-arm64, whatever the machine.
beforeEach(() => updates.setUpdatePlatform({ platform: 'darwin', arch: 'arm64' }))
afterEach(() => updates.setUpdatePlatform(null))

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
    updates.setUpdatePublicKey(publicPem)
    delete process.env.WEBDECK_CHROME_VERSION
  })
  afterEach(() => {
    updates.setUpdateBroadcaster(null)
    updates.resetDownloadForTests()
    updates.setUpdatePublicKey(null)
    delete process.env.WEBDECK_VERSION
  })

  // The release key for these tests, pinned into the checker.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const signWith = (manifest: unknown, key = privateKey): string =>
    cryptoSign(null, Buffer.from(canonicalize(manifest), 'utf8'), key).toString('base64')

  /**
   * A release whose feed answers from the local server, with `assets`, plus a
   * signed update.json naming them — unless `opts.unsigned`, or `opts.badKey`
   * (signed with a key the checker does not pin).
   */
  const publish = (
    assets: Array<{ name: string; body: Buffer }>,
    extra: string[] = [],
    opts: {
      version?: string
      unsigned?: boolean
      badKey?: boolean
      chromium?: string
      rollout?: number
      critical?: boolean
      manifestAssets?: Array<{ name: string; sha256: string; size: number }>
      more?: Array<{ tag: string; manifestOk?: boolean }>
    } = {}
  ): void => {
    files.clear()
    const version = opts.version ?? '0.2.0'
    for (const { name, body } of assets) files.set(`/${name}`, body)
    const list = [
      ...assets.map(({ name, body }) => ({
        name,
        browser_download_url: `${base}/${name}`,
        size: body.length
      })),
      ...extra.map((name) => ({ name, browser_download_url: `${base}/${name}`, size: 0 }))
    ]
    if (!opts.unsigned) {
      const manifest = {
        channel: 'stable',
        version,
        chromium: opts.chromium ?? '',
        rollout: opts.rollout ?? 100,
        critical: opts.critical ?? false,
        assets:
          opts.manifestAssets ??
          assets.map(({ name, body }) => ({
            name,
            sha256: createHash('sha256').update(body).digest('hex'),
            size: body.length
          }))
      }
      const key = opts.badKey ? generateKeyPairSync('ed25519').privateKey : privateKey
      files.set(
        `/update.json`,
        Buffer.from(JSON.stringify({ manifest, signature: signWith(manifest, key) }))
      )
      list.push({ name: 'update.json', browser_download_url: `${base}/update.json`, size: 0 })
    }
    const releases: unknown[] = [
      { tag_name: `v${version}`, html_url: `https://r/${version}`, assets: list }
    ]
    for (const m of opts.more ?? []) {
      const v = m.tag.replace(/^v/, '')
      const name = `Arcwel-WebDeck-${v}-arm64.dmg`
      const body = Buffer.from(`build ${v}`)
      files.set(`/${v}/${name}`, body)
      const mlist = [{ name, browser_download_url: `${base}/${v}/${name}`, size: body.length }]
      if (m.manifestOk !== false) {
        const manifest = {
          channel: 'stable',
          version: v,
          chromium: '',
          rollout: 100,
          critical: false,
          assets: [
            { name, sha256: createHash('sha256').update(body).digest('hex'), size: body.length }
          ]
        }
        files.set(
          `/${v}/update.json`,
          Buffer.from(JSON.stringify({ manifest, signature: signWith(manifest) }))
        )
        mlist.push({
          name: 'update.json',
          browser_download_url: `${base}/${v}/update.json`,
          size: 0
        })
      }
      releases.push({ tag_name: m.tag, html_url: `https://r/${v}`, assets: mlist })
    }
    files.set('/feed', Buffer.from(JSON.stringify(releases)))
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
      expect(checked.available?.signed).toBe(true)
      expect(checked.available?.sha256).toMatch(/^[0-9a-f]{64}$/)
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

  it('refuses a download whose bytes do not match the signed digest, and cleans up', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      manifestAssets: [{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', sha256: '0'.repeat(64), size: 7 }]
    })
    await updates.checkForUpdates()
    const status = await updates.downloadUpdate()
    expect(status.download?.phase).toBe('error')
    expect(status.download?.error).toMatch(/digest/)
    expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.dmg'))).toBe(false)
    expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.dmg.part'))).toBe(false)
  })

  it('refuses a download that stops short of its declared size', async () => {
    const body = Buffer.from('a build')
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body }], [], {
      manifestAssets: [
        {
          name: 'Arcwel-WebDeck-0.2.0-arm64.dmg',
          sha256: createHash('sha256').update(body).digest('hex'),
          size: 999
        }
      ]
    })
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

  it('gives up a transfer that goes quiet, and says so', async () => {
    updates.setDownloadStallMs(300)
    // A body that sends a few bytes and then never finishes, and — like a real
    // fetch — fails its reader when the request's signal is aborted.
    const stalledFetch: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/feed') || String(url).endsWith('/update.json')) return fetch(url)
      const signal = init?.signal
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]))
        },
        pull: () =>
          new Promise((_, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          )
      })
      return new Response(body, { status: 200, headers: { 'content-length': '999' } })
    }
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.alloc(999, 1) }])
    await updates.checkForUpdates()
    updates.setUpdateFetch(stalledFetch)
    const status = await updates.downloadUpdate()
    expect(status.download?.phase).toBe('error')
    expect(status.download?.error).toMatch(/stalled/)
    expect(existsSync(join(home, 'Downloads', 'Arcwel-WebDeck-0.2.0-arm64.dmg.part'))).toBe(false)
    updates.setDownloadStallMs(60_000)
  })

  it('never downloads a release without a signed manifest, and says why', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      unsigned: true
    })
    const checked = await updates.checkForUpdates()
    expect(checked.available?.asset?.name).toBe('Arcwel-WebDeck-0.2.0-arm64.dmg')
    expect(checked.available?.signed).toBe(false)
    expect(checked.available?.unsignedReason).toMatch(/no signed manifest/)
    await expect(updates.downloadUpdate()).rejects.toThrow(/not signed for in-app update/)
  })

  it('treats a manifest signed with the wrong key as unsigned', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      badKey: true
    })
    const checked = await updates.checkForUpdates()
    expect(checked.available?.signed).toBe(false)
    expect(checked.available?.unsignedReason).toMatch(/does not match the pinned key/)
  })

  it('flags a release built on a newer Chromium, or marked critical, as carrying security fixes', async () => {
    process.env.WEBDECK_CHROME_VERSION = '153.0.8010.12'
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      chromium: '154.0.8100.3'
    })
    expect((await updates.checkForUpdates()).available?.security).toBe(true)
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      chromium: '153.0.8010.12'
    })
    expect((await updates.checkForUpdates()).available?.security).toBe(false)
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      chromium: '153.0.8010.12',
      critical: true
    })
    expect((await updates.checkForUpdates()).available?.security).toBe(true)
  })

  it('holds a staged release back from installs outside its wave, and offers it to the rest', async () => {
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      rollout: 100
    })
    const first = await updates.checkForUpdates()
    expect(first.available?.version).toBe('0.2.0')
    const id = JSON.parse(readFileSync(join(dir, 'update-check.json'), 'utf8')).installId as string
    expect(id).toMatch(/[0-9a-f-]{36}/)
    const bucket = rolloutBucket(id, '0.2.0')
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      rollout: bucket
    })
    const held = await updates.checkForUpdates()
    expect(held.available).toBeNull()
    expect(held.staged).toEqual({ version: '0.2.0', rollout: bucket })
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      rollout: bucket + 1
    })
    const offered = await updates.checkForUpdates()
    expect(offered.available?.version).toBe('0.2.0')
    expect(offered.staged).toBeNull()
  })

  it('names the previous release on the channel and downloads it by version, for going back', async () => {
    process.env.WEBDECK_VERSION = '0.1.5'
    publish([{ name: 'Arcwel-WebDeck-0.2.0-arm64.dmg', body: Buffer.from('a build') }], [], {
      more: [{ tag: 'v0.1.4' }, { tag: 'v0.1.2' }, { tag: 'v0.1.5' }]
    })
    const checked = await updates.checkForUpdates()
    expect(checked.available?.version).toBe('0.2.0')
    expect(checked.previous?.version).toBe('0.1.4')
    expect(checked.previous?.signed).toBe(true)
    const status = await updates.downloadUpdate('0.1.4')
    expect(status.download?.version).toBe('0.1.4')
    expect(status.download?.phase).toBe('done')
    await expect(updates.downloadUpdate('0.1.2')).rejects.toThrow(/not on offer/)
  })

  it('says so when the release has no build for this machine', async () => {
    publish([], ['source.tar.gz'])
    const checked = await updates.checkForUpdates()
    expect(checked.available?.asset).toBeNull()
    await expect(updates.downloadUpdate()).rejects.toThrow(/no build to download/)
  })
})
