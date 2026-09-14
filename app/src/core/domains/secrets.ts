import { coreEnv } from '../env'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { core } from '../rpc'
import { fetchSecretFromCommand, getSecretSource, setSecretSource } from './secret-source'

/**
 * Secret storage for provider API keys.
 *
 * Keys are encrypted with Electron's `safeStorage`, which is backed by the OS
 * credential store — Keychain on macOS, libsecret on Linux, DPAPI on Windows —
 * so the ciphertext on disk is worthless without the logged-in user's session.
 * We never hand a decrypted key to the renderer: the renderer only ever learns
 * *whether* a provider is configured (a masked hint), and the plaintext leaves
 * the main process solely on an outbound request the user's own agent made.
 *
 * This is why API keys are not part of app-settings.json — that file is
 * plaintext JSON, appropriate for preferences and wrong for credentials.
 */

export type Provider = 'anthropic' | 'openai' | 'gemini'
export const PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini']

interface StoredSecret {
  /** Base64 safeStorage ciphertext, or plaintext when encryption is absent. */
  value: string
  encrypted: boolean
}

function file(): string {
  return join(coreEnv().userDataDir, 'secrets.json')
}

function loadAll(): Record<string, StoredSecret> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Record<string, StoredSecret>
  } catch {
    return {}
  }
}

function saveAll(all: Record<string, StoredSecret>): void {
  try {
    writeFileSync(file(), `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  } catch {
    // Read-only userData: the key holds for this run but will not persist.
  }
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as string[]).includes(value)
}

export function setApiKey(provider: unknown, key: unknown): boolean {
  if (!isProvider(provider) || typeof key !== 'string') return false
  const all = loadAll()
  if (key.trim() === '') {
    delete all[provider]
    saveAll(all)
    return true
  }
  if (coreEnv().secrets.isAvailable()) {
    all[provider] = {
      value: coreEnv().secrets.encryptString(key).toString('base64'),
      encrypted: true
    }
  } else {
    // No OS keyring (a headless Linux box, say). Storing plaintext would be a
    // silent downgrade of a security promise, so we refuse instead.
    return false
  }
  saveAll(all)
  return true
}

/** The decrypted key, for the main process only. Never sent to the renderer. */
export function getApiKey(provider: Provider): string | null {
  // A configured password-manager command wins: in that mode WebDeck holds no
  // key of its own, and asking the vault is the whole point.
  if (getSecretSource().mode === 'command') {
    return fetchSecretFromCommand(provider)
  }
  const stored = loadAll()[provider]
  if (!stored) return null
  if (!stored.encrypted) return stored.value
  try {
    return coreEnv().secrets.decryptString(Buffer.from(stored.value, 'base64'))
  } catch {
    return null
  }
}

/** What the renderer is allowed to know: which providers have a key set. */
export function listConfiguredProviders(): Record<Provider, boolean> {
  const all = loadAll()
  return {
    anthropic: Boolean(all.anthropic),
    openai: Boolean(all.openai),
    gemini: Boolean(all.gemini)
  }
}

export function clearApiKey(provider: unknown): boolean {
  if (!isProvider(provider)) return false
  const all = loadAll()
  delete all[provider]
  saveAll(all)
  return true
}

/**
 * A key for a user-typed model endpoint, kept in the same encrypted store under
 * `endpoint:<name>`. Not a provider the settings key rows know: those three are
 * the cloud providers, and an endpoint is whatever the user pointed at.
 */
const ENDPOINT_PREFIX = 'endpoint:'

export function setEndpointKey(name: string, key: string): boolean {
  if (!name || key.trim() === '') return clearEndpointKey(name)
  if (!coreEnv().secrets.isAvailable()) return false
  const all = loadAll()
  all[`${ENDPOINT_PREFIX}${name}`] = {
    value: coreEnv().secrets.encryptString(key).toString('base64'),
    encrypted: true
  }
  saveAll(all)
  return true
}

export function getEndpointKey(name: string): string | null {
  const stored = loadAll()[`${ENDPOINT_PREFIX}${name}`]
  if (!stored) return null
  if (!stored.encrypted) return stored.value
  try {
    return coreEnv().secrets.decryptString(Buffer.from(stored.value, 'base64'))
  } catch {
    return null
  }
}

export function hasEndpointKey(name: string): boolean {
  return Boolean(loadAll()[`${ENDPOINT_PREFIX}${name}`])
}

export function clearEndpointKey(name: string): boolean {
  const all = loadAll()
  delete all[`${ENDPOINT_PREFIX}${name}`]
  saveAll(all)
  return true
}

export function isEncryptionAvailable(): boolean {
  return coreEnv().secrets.isAvailable()
}

/**
 * Register the secrets domain with webdeck-core.
 *
 * Secrets is the pilot for the P1 decoupling: a self-contained "core" domain
 * (keychain + files, no browser/window/dialog dependency) whose handlers no
 * longer touch `ipcMain` directly. Under Electron the electron transport binds
 * these to IPC; under the Chromium fork the same three lines bind to a socket.
 */
export function registerSecretsRpc(): void {
  core.register(IpcChannels.secretsList, () => {
    const source = getSecretSource()
    return {
      encryptionAvailable: isEncryptionAvailable(),
      // In command mode "configured" means the command yields a value, not that
      // we hold a key — WebDeck stores nothing in that mode.
      configured:
        source.mode === 'command'
          ? {
              anthropic: Boolean(fetchSecretFromCommand('anthropic')),
              openai: Boolean(fetchSecretFromCommand('openai')),
              gemini: Boolean(fetchSecretFromCommand('gemini'))
            }
          : listConfiguredProviders(),
      source
    }
  })
  core.register(IpcChannels.secretsSet, (provider, key) => setApiKey(provider, key))
  core.register(IpcChannels.secretsClear, (provider) => clearApiKey(provider))
  core.register(IpcChannels.secretsSetSource, (config) =>
    setSecretSource((config ?? {}) as Parameters<typeof setSecretSource>[0])
  )
}
