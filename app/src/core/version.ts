/** Build-time stamps from scripts/build-core.mjs, each overridable by an
 *  environment variable for a test or a staged run. */
declare const __WEBDECK_VERSION__: string | undefined
declare const __WEBDECK_CHROMIUM__: string | undefined
declare const __WEBDECK_UPDATE_PUBKEY__: string | undefined

/** The core's own version, from package.json. */
export function appVersion(): string {
  if (process.env.WEBDECK_VERSION) return process.env.WEBDECK_VERSION
  return typeof __WEBDECK_VERSION__ === 'string' ? __WEBDECK_VERSION__ : '0.0.0-dev'
}

/** The Chromium base this build runs on. The browser tells the core at spawn
 *  (WEBDECK_CHROME_VERSION); the build stamp from chromium/fork.json is the
 *  fallback for a core started on its own. */
export function chromiumVersion(): string {
  if (process.env.WEBDECK_CHROME_VERSION) return process.env.WEBDECK_CHROME_VERSION
  return typeof __WEBDECK_CHROMIUM__ === 'string' ? __WEBDECK_CHROMIUM__ : ''
}

/** The Ed25519 public key (PEM) update manifests must verify against, from
 *  app/release/update-pubkey.pem at build time. Empty means no key is pinned,
 *  and then no release is ever downloaded in-app. */
export function updatePublicKey(): string {
  if (process.env.WEBDECK_UPDATE_PUBKEY) return process.env.WEBDECK_UPDATE_PUBKEY
  return typeof __WEBDECK_UPDATE_PUBKEY__ === 'string' ? __WEBDECK_UPDATE_PUBKEY__ : ''
}
