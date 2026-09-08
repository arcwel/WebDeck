/** The core's own version: stamped at build time from package.json by
 *  scripts/build-core.mjs, overridable for a test or a staged run. */
declare const __WEBDECK_VERSION__: string | undefined

export function appVersion(): string {
  if (process.env.WEBDECK_VERSION) return process.env.WEBDECK_VERSION
  return typeof __WEBDECK_VERSION__ === 'string' ? __WEBDECK_VERSION__ : '0.0.0-dev'
}
