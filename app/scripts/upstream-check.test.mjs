import { describe, it, expect } from 'vitest'
import { buildResult, compareVersions, exitCodeFor, parseVersion } from './upstream-check.mjs'

// Everything here is the pure half of the check: version comparison, the
// verdict it produces, and the exit code that follows. The network fetch and
// `git apply` live behind their own functions and are passed in as data, so
// nothing in this file touches either.

const patchesClean = {
  checked: true,
  checkoutPath: '/tmp/src',
  checkoutVersion: '153.0.8010.12',
  checkedAgainstUpstream: false,
  patchFile: 'chromium/patches/upstream-edits.diff',
  files: [{ path: 'chrome/chrome_paks.gni', status: 'applies' }],
  conflicts: 0
}

const patchesUnchecked = {
  checked: false,
  checkoutPath: '/nowhere/src',
  reason: 'no Chromium checkout at /nowhere/src',
  patchFile: 'chromium/patches/upstream-edits.diff',
  files: [],
  conflicts: 0
}

const check = (pinnedVersion, upstreamVersion, patches = patchesClean) =>
  buildResult({
    channel: 'stable',
    platform: 'Mac',
    pinned: { version: pinnedVersion, source: 'chromium/fork.json' },
    upstream: { version: upstreamVersion, milestone: Number(upstreamVersion.split('.')[0]) },
    patches
  })

describe('parseVersion', () => {
  it('splits a Chromium version into numbers', () => {
    expect(parseVersion('153.0.8010.12')).toEqual([153, 0, 8010, 12])
  })

  it('rejects anything that is not four numeric components', () => {
    expect(parseVersion('153.0.8010')).toBeNull()
    expect(parseVersion('153.0.8010.12.1')).toBeNull()
    expect(parseVersion('153.0.80x0.12')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
    expect(parseVersion(1530801012)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('compares the build component numerically, not as a string', () => {
    // '8010' > '8100' lexicographically. Getting this wrong reports a fork that
    // is a whole branch behind as up to date.
    expect(compareVersions(parseVersion('153.0.8010.12'), parseVersion('153.0.8100.2'))).toBe(-1)
    expect(compareVersions(parseVersion('153.0.8100.2'), parseVersion('153.0.8010.12'))).toBe(1)
  })

  it('compares the patch component numerically', () => {
    // '12' < '9' as strings, 12 > 9 as numbers.
    expect(compareVersions(parseVersion('153.0.8010.12'), parseVersion('153.0.8010.9'))).toBe(1)
  })

  it('returns 0 for equal versions', () => {
    expect(compareVersions(parseVersion('153.0.8010.12'), parseVersion('153.0.8010.12'))).toBe(0)
  })

  it('compares the milestone first', () => {
    expect(compareVersions(parseVersion('99.0.9999.99'), parseVersion('153.0.8010.12'))).toBe(-1)
  })
})

describe('buildResult', () => {
  it('reports current when the pin matches upstream', () => {
    const result = check('153.0.8010.12', '153.0.8010.12')
    expect(result.status).toBe('current')
    expect(result.delta).toEqual({ comparison: 0, milestones: 0 })
    expect(result.exitCode).toBe(0)
  })

  it('reports behind, with the milestone gap, when upstream has moved on', () => {
    const result = check('153.0.8010.12', '154.0.8025.0')
    expect(result.status).toBe('behind')
    expect(result.delta.milestones).toBe(1)
    expect(result.exitCode).toBe(1)
  })

  it('reports behind on a same-milestone security refresh', () => {
    const result = check('153.0.8010.12', '153.0.8010.31')
    expect(result.status).toBe('behind')
    expect(result.delta.milestones).toBe(0)
    expect(result.exitCode).toBe(1)
  })

  it('reports ahead rather than behind when we lead the channel', () => {
    const result = check('154.0.8025.0', '153.0.8010.12')
    expect(result.status).toBe('ahead')
    expect(result.exitCode).toBe(0)
  })

  it('throws on an unparseable version rather than guessing', () => {
    expect(() => check('unknown', '153.0.8010.12')).toThrow(/pinned version/)
    expect(() => check('153.0.8010.12', 'tip-of-tree')).toThrow(/upstream version/)
  })

  it('emits the documented JSON shape', () => {
    const result = check('153.0.8010.12', '154.0.8025.0')
    expect(Object.keys(result)).toEqual([
      'ok',
      'status',
      'channel',
      'platform',
      'pinned',
      'upstream',
      'delta',
      'patches',
      'security',
      'exitCode'
    ])
    expect(result.ok).toBe(true)
    expect(result.pinned).toEqual({
      version: '153.0.8010.12',
      milestone: 153,
      source: 'chromium/fork.json'
    })
    expect(result.upstream).toEqual({ version: '154.0.8025.0', milestone: 154, released: null })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('carries an unchecked patch set through as unchecked, with a reason', () => {
    const result = check('153.0.8010.12', '153.0.8010.12', patchesUnchecked)
    expect(result.patches.checked).toBe(false)
    expect(result.patches.reason).toMatch(/no Chromium checkout/)
    // No checkout means no evidence either way — it must not read as a pass.
    expect(result.patches).not.toHaveProperty('checkoutVersion')
  })
})

describe('exitCodeFor', () => {
  const base = {
    ok: true,
    status: 'current',
    patches: patchesClean
  }

  it('is 0 when current and every patch applies', () => {
    expect(exitCodeFor(base)).toBe(0)
  })

  it('is 1 when behind', () => {
    expect(exitCodeFor({ ...base, status: 'behind' })).toBe(1)
  })

  it('is 1 when current but a tracked patch no longer applies', () => {
    // The silent-rot case: nothing about the version says anything is wrong.
    const patches = {
      ...patchesClean,
      files: [{ path: 'chrome/chrome_paks.gni', status: 'conflict' }],
      conflicts: 1
    }
    expect(exitCodeFor({ ...base, patches })).toBe(1)
  })

  it('is 0, not 1, when the patch set was never checked', () => {
    // "Not checked" is reported in the output; it is not an error state.
    expect(exitCodeFor({ ...base, patches: patchesUnchecked })).toBe(0)
  })

  it('is 2 whenever the check itself failed', () => {
    expect(exitCodeFor({ ok: false, status: 'current', patches: patchesClean })).toBe(2)
  })
})

describe('securityFromPosts', () => {
  it('counts the CVEs announced for versions in the range, by severity, ignoring Android and iOS posts', async () => {
    const { securityFromPosts } = await import('./upstream-check.mjs')
    const posts = [
      {
        title: 'Stable Channel Update for Desktop',
        text: 'The Stable channel has been updated to 153.0.8010.36 for Windows, Mac and Linux. [$2,500][ 544163112 ] Critical CVE-2026-87464: Use after free in WebGL. [N/A][ 546252753 ] High CVE-2026-87488: Use after free. [TBD][ 548127218 ] Medium CVE-2026-87438: Out of bounds write.'
      },
      {
        title: 'Chrome for Android Update',
        text: 'Chrome 153 (153.0.8010.36) for Android has been released.'
      },
      {
        title: 'Stable Channel Update for Desktop',
        text: 'The Stable channel has been updated to 152.0.7900.10. [N/A][1] Critical CVE-2026-1: old.'
      },
      {
        title: 'Stable Channel Update for Desktop',
        text: 'Updated to 154.0.8037.17. This update includes 12 security fixes. [N/A][ 9 ] High CVE-2026-2: x.'
      }
    ]
    const result = securityFromPosts(posts, '153.0.8010.12', '154.0.8037.17')
    expect(result.checked).toBe(true)
    expect(result.posts.map((p) => [p.version, p.fixes, p.highest])).toEqual([
      ['153.0.8010.36', 3, 'Critical'],
      ['154.0.8037.17', 12, 'High']
    ])
    expect(result.fixes).toBe(15)
    expect(result.highest).toBe('Critical')
  })
})
