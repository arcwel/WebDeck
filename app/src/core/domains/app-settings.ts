import { coreEnv } from '../env'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { core } from '../rpc'

/**
 * Application-level settings — the Electron ones.
 *
 * The Settings block already edited the *editor's* settings (VS Code's
 * `settings.json`, keybindings, colours), which left the application itself
 * unconfigurable: no way to change what the app does at launch, what a page is
 * allowed to do, or what state it keeps on disk. These are those settings.
 *
 * Two of them — hardware acceleration and the spellchecker's languages — must
 * be decided before the first window exists, so they are read from disk during
 * bootstrap and applied on the next launch rather than live. The rest apply
 * immediately.
 */

export interface AppSettings {
  /** GPU compositing. Off is the standard remedy for driver rendering bugs. */
  hardwareAcceleration: boolean
  /** Spellcheck in page text fields. */
  spellcheck: boolean
  /** BCP-47 languages the spellchecker loads. */
  spellcheckLanguages: string[]
  /** Ask before a page may use camera, mic, location, notifications… */
  askForPermissions: boolean
  /** Send Do Not Track with every request. */
  doNotTrack: boolean
  /** Restore the previous session's tabs at launch. */
  restoreTabs: boolean
  /** Where downloads go when not asked each time. Empty = OS Downloads. */
  downloadPath: string
  /** Prompt for a location on every download (Chrome's "ask where to save"). */
  askWhereToSave: boolean
  /** Search-engine id used for address-bar queries. */
  searchEngine: string
  showAskButton: boolean
  profileImage: string
  customEditorsOpenIn: 'browser' | 'deck'
}

const DEFAULTS: AppSettings = {
  hardwareAcceleration: true,
  spellcheck: true,
  spellcheckLanguages: ['en-US'],
  askForPermissions: true,
  doNotTrack: false,
  restoreTabs: true,
  downloadPath: '',
  askWhereToSave: false,
  searchEngine: 'duckduckgo',
  showAskButton: true,
  profileImage: '',
  customEditorsOpenIn: 'browser'
}

function file(): string {
  return join(coreEnv().userDataDir, 'app-settings.json')
}

let cache: AppSettings | null = null

export function readAppSettings(): AppSettings {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>
    cache = { ...DEFAULTS, ...raw }
  } catch {
    // No file yet, or it was hand-edited into something unparseable. Defaults
    // are always a working configuration, so this is not worth surfacing.
    cache = { ...DEFAULTS }
  }
  return cache
}

/**
 * Keep only known keys, correctly typed, from an untrusted patch.
 *
 * Every other IPC handler validates its payload; this one is reached from the
 * renderer too, so an arbitrary object must not be able to inject unknown keys
 * or wrong-typed values (e.g. a non-array `spellcheckLanguages`, which would
 * later be handed to `session.setSpellCheckerLanguages`) into persisted state.
 */
/** Room for a 128px PNG with margin, and far short of anything that would
 *  make the settings read slow. */
const MAX_PROFILE_IMAGE_CHARS = 256 * 1024

export function sanitizePatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  const clean: Partial<AppSettings> = {}
  const bool = (v: unknown): v is boolean => typeof v === 'boolean'
  if (bool(patch.hardwareAcceleration)) clean.hardwareAcceleration = patch.hardwareAcceleration
  if (bool(patch.spellcheck)) clean.spellcheck = patch.spellcheck
  if (bool(patch.askForPermissions)) clean.askForPermissions = patch.askForPermissions
  if (bool(patch.doNotTrack)) clean.doNotTrack = patch.doNotTrack
  if (bool(patch.restoreTabs)) clean.restoreTabs = patch.restoreTabs
  if (typeof patch.downloadPath === 'string') clean.downloadPath = patch.downloadPath
  if (bool(patch.askWhereToSave)) clean.askWhereToSave = patch.askWhereToSave
  if (typeof patch.searchEngine === 'string') clean.searchEngine = patch.searchEngine
  if (patch.customEditorsOpenIn === 'browser' || patch.customEditorsOpenIn === 'deck') {
    clean.customEditorsOpenIn = patch.customEditorsOpenIn
  }
  if (bool(patch.showAskButton)) clean.showAskButton = patch.showAskButton
  // A square PNG data URL and nothing else. The cap is what keeps a settings
  // file that is read on every boot from carrying a megapixel photo.
  if (typeof patch.profileImage === 'string') {
    const image = patch.profileImage
    const ok =
      image === '' ||
      (image.startsWith('data:image/png;base64,') && image.length <= MAX_PROFILE_IMAGE_CHARS)
    if (ok) clean.profileImage = image
  }
  if (Array.isArray(patch.spellcheckLanguages)) {
    clean.spellcheckLanguages = patch.spellcheckLanguages.filter((l) => typeof l === 'string')
  }
  return clean
}

export function writeAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...readAppSettings(), ...sanitizePatch(patch) }
  cache = next
  try {
    writeFileSync(file(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch {
    // Read-only userData: the setting still applies for this run.
  }
  notify(next)
  return next
}

export type ClearableData = 'cache' | 'cookies' | 'storage' | 'history'

/**
 * Live-apply is delegated, not done here.
 *
 * Spellcheck and Do-Not-Track have to reach the *browser profile* sessions
 * (`persist:agweb-browser`, `persist:profile-*`) where pages actually run —
 * not `session.defaultSession`, which no tab uses. profiles.ts owns those
 * sessions, so it registers a listener here and applies the change to each.
 * Keeping the session work out of this module also avoids an import cycle
 * (profiles → permissions → app-settings).
 */
type ChangeListener = (settings: AppSettings) => void
const listeners = new Set<ChangeListener>()

export function onAppSettingsChanged(listener: ChangeListener): void {
  listeners.add(listener)
}

function notify(settings: AppSettings): void {
  for (const listener of listeners) listener(settings)
}

/**
 * Settings that must be decided before `app.whenReady()`.
 *
 * Electron ignores `disableHardwareAcceleration` after the app is ready, so the
 * shell reads this at the top of its entry point — before anything else. Kept as
 * a pure predicate so this store imports no Electron (the shell owns the call).
 */
export function shouldDisableHardwareAcceleration(): boolean {
  return !readAppSettings().hardwareAcceleration
}

/** Push the current settings to every registered session listener. */
export function initAppSettings(): void {
  notify(readAppSettings())
}

/** Register the app-settings store (read/write) with webdeck-core (P1).
 *  readSync (boot), clearData (session) and chooseDownloadDir (dialog) stay
 *  shell-side — see CHROMIUM_MIGRATION.md. */
export function registerAppSettingsRpc(): void {
  core.register(IpcChannels.appSettingsRead, () => readAppSettings())
  core.register(IpcChannels.appSettingsWrite, (patch) =>
    writeAppSettings((patch ?? {}) as Partial<AppSettings>)
  )
}
