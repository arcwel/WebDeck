/**
 * Release checking, shared between the core (which asks the feed) and the
 * shell (which shows the chip). A build knows its own version; the feed is the
 * repository's releases; "this release branch" is the channel the running
 * version is on — a stable build only ever hears about stable releases, a
 * pre-release build hears about both.
 */

export type ReleaseChannel = 'stable' | 'pre'

/** A downloadable build attached to a release. */
export interface ReleaseAsset {
  name: string
  url: string
  /** Bytes, as the feed reports them; 0 when unknown. */
  size: number
}

export interface ReleaseInfo {
  /** Plain version, no leading v: "0.2.0", "0.2.0-rc.1". */
  version: string
  tag: string
  /** The release page. */
  url: string
  publishedAt: string
  /** The release notes, plain text, capped. */
  notes: string
  prerelease: boolean
  /** The build for this machine, when the release carries one; "Update now"
   *  downloads it. Null means the release page is the only way in. */
  asset: ReleaseAsset | null
  /** The release published a manifest that verifies against the pinned key,
   *  and it names `asset`. Only a signed release is downloaded in-app. */
  signed: boolean
  /** Why it is not signed, when it is not: no manifest, bad signature, asset
   *  not named. Null when signed. */
  unsignedReason: string | null
  /** The asset's digest from the signed manifest; null when unsigned. */
  sha256: string | null
  /** The Chromium base the release was built from, from the manifest. */
  chromium: string | null
  /** The release carries Chromium security fixes (a newer base than the
   *  running build) or the release engineer marked it critical. */
  security: boolean
  /** Percent of installs the release is offered to. */
  rollout: number
}

export type DownloadPhase = 'downloading' | 'verifying' | 'unpacking' | 'done' | 'error'

/** Where "Update now" is with the build it fetched. */
export interface DownloadState {
  version: string
  phase: DownloadPhase
  received: number
  /** Bytes expected; 0 when the feed did not say. */
  total: number
  /** Once done: the unpacked app (or the archive itself when it is not a zip). */
  path: string | null
  error: string | null
}

export interface UpdateStatus {
  current: string
  channel: ReleaseChannel
  /** ISO time of the last completed check, or null before the first. */
  checkedAt: string | null
  /** The newest release on this channel that is newer than `current`, or null. */
  available: ReleaseInfo | null
  /** The version the user said "not now" to; the chip stays down for it. */
  dismissed: string | null
  /** Why the last check did not complete, or null. */
  error: string | null
  /** Whether a check is running right now. */
  checking: boolean
  /** The download in progress or just finished, if any. */
  download: DownloadState | null
  /** A newer release exists but is rolling out gradually and this install is
   *  not in the current wave. Nothing is offered; About says so. */
  staged: { version: string; rollout: number } | null
  /** The release just below the running one on this channel, for going back. */
  previous: ReleaseInfo | null
}

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Pre-release identifiers ("rc.1" → ["rc", "1"]); empty for a stable version. */
  pre: string[]
}

/** "v1.2.3-rc.1" → parts; null for anything that is not a version. */
export function parseVersion(text: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : []
  }
}

/** The channel a version is on: a pre-release suffix puts it on "pre". */
export function channelOf(version: string): ReleaseChannel {
  return (parseVersion(version)?.pre.length ?? 0) > 0 ? 'pre' : 'stable'
}

function compareIdentifiers(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na) return -1 // numeric identifiers sort before alphanumeric ones
  if (nb) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semantic-version order: negative when a < b. A stable version outranks its pre-releases. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  const n = Math.min(a.pre.length, b.pre.length)
  for (let i = 0; i < n; i++) {
    const c = compareIdentifiers(a.pre[i], b.pre[i])
    if (c !== 0) return c
  }
  return a.pre.length - b.pre.length
}

/**
 * The newest release on the running version's channel that is newer than it,
 * or null. Drafts and unparsable tags are ignored; a stable build ignores
 * pre-releases.
 */
export function newestOnChannel(
  current: string,
  releases: ReadonlyArray<ReleaseInfo>
): ReleaseInfo | null {
  const mine = parseVersion(current)
  if (!mine) return null
  const stableOnly = channelOf(current) === 'stable'
  let best: { release: ReleaseInfo; parsed: ParsedVersion } | null = null
  for (const release of releases) {
    if (stableOnly && release.prerelease) continue
    const parsed = parseVersion(release.version)
    if (!parsed || compareVersions(parsed, mine) <= 0) continue
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { release, parsed }
  }
  return best?.release ?? null
}

/**
 * The asset for this machine, out of a release's attachments: a zip (what the
 * in-app download unpacks) over a dmg, and one that names the architecture
 * over one that does not. Anything that is neither is not a build.
 */
export function pickAsset(
  assets: ReadonlyArray<ReleaseAsset>,
  platform: string,
  arch: string
): ReleaseAsset | null {
  if (platform !== 'darwin') return null
  const archWords =
    arch === 'arm64' ? ['arm64', 'aarch64', 'apple-silicon'] : [arch, 'x86_64', 'intel']
  const score = (a: ReleaseAsset): number => {
    const name = a.name.toLowerCase()
    const kind = name.endsWith('.zip') ? 2 : name.endsWith('.dmg') ? 1 : 0
    if (kind === 0) return 0
    const named = archWords.some((w) => name.includes(w))
    const other = (arch === 'arm64' ? ['x86_64', 'x64', 'intel'] : ['arm64', 'aarch64']).some((w) =>
      name.includes(w)
    )
    if (other && !named) return 0
    return kind * 10 + (named ? 1 : 0)
  }
  let best: ReleaseAsset | null = null
  let bestScore = 0
  for (const asset of assets) {
    const s = score(asset)
    if (s > bestScore) {
      best = asset
      bestScore = s
    }
  }
  return best
}
