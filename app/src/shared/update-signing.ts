/**
 * The signed update manifest: what a release publishes beside its build so
 * the updater can trust the bytes it fetches. The manifest names the build's
 * assets with their digests; an Ed25519 signature over its canonical form is
 * checked against a public key pinned in the core. A release without a valid
 * manifest is still shown, but never downloaded in-app — the digest would
 * otherwise come from the same host as the asset, which proves nothing.
 *
 * `canonicalize` is the exact algorithm scripts/update-check.mjs signs with;
 * the two must never drift or every signature fails.
 */

export interface ManifestAsset {
  name: string
  /** Hex SHA-256 of the file. */
  sha256: string
  size: number
}

export interface UpdateManifest {
  /** The channel the release is on; a stable build ignores "pre" releases. */
  channel: 'stable' | 'pre'
  /** Plain version, no leading v. */
  version: string
  /** The Chromium base the build was made from; newer than the running one
   *  means the release carries upstream security fixes. */
  chromium: string
  /** Percent of installs the release is offered to, 0–100. */
  rollout: number
  /** Set by the release engineer when the release must not be deferred. */
  critical: boolean
  assets: ManifestAsset[]
}

export interface SignedManifest {
  manifest: UpdateManifest
  /** Base64 Ed25519 signature over canonicalize(manifest). */
  signature: string
  keyId?: string
}

/** Sorted-key JSON: the bytes that are signed and verified. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The shape check, before any cryptography: null for anything malformed. */
export function parseSignedManifest(raw: unknown): SignedManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const m = r.manifest
  if (!m || typeof m !== 'object' || typeof r.signature !== 'string' || !r.signature) return null
  const x = m as Record<string, unknown>
  if (typeof x.version !== 'string' || !Array.isArray(x.assets)) return null
  const assets: ManifestAsset[] = []
  for (const a of x.assets as unknown[]) {
    if (!a || typeof a !== 'object') return null
    const y = a as Record<string, unknown>
    if (typeof y.name !== 'string' || typeof y.sha256 !== 'string' || typeof y.size !== 'number')
      return null
    assets.push({ name: y.name, sha256: y.sha256.toLowerCase(), size: y.size })
  }
  const rollout = typeof x.rollout === 'number' ? Math.max(0, Math.min(100, x.rollout)) : 100
  return {
    manifest: {
      channel: x.channel === 'pre' ? 'pre' : 'stable',
      version: x.version,
      chromium: typeof x.chromium === 'string' ? x.chromium : '',
      rollout,
      critical: x.critical === true,
      assets
    },
    signature: r.signature,
    ...(typeof r.keyId === 'string' ? { keyId: r.keyId } : {})
  }
}

/**
 * Which hundredth of the installs this one is, for a given version: a stable
 * bucket per install and release, so a staged rollout offers the release to
 * the same machines on every check and a different slice for each version.
 * FNV-1a over the pair; no cryptography needed for a coin flip.
 */
export function rolloutBucket(installId: string, version: string): number {
  const text = `${installId}:${version}`
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100
}
