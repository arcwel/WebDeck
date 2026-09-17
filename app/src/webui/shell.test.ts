import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SHELL_BROWSER, SHELL_BROWSER_EVENTS, toRect } from './shell'
import { IpcChannels, IpcEvents } from '@shared/ipc'

/**
 * The shell bridge is the renderer's half of the Shell privilege boundary: it
 * drives the window's REAL tab over the Mojo Shell. Two things keep that safe —
 * `SHELL_BROWSER` is a KNOWN list of browser.* channels (an unknown channel must
 * NOT be in it, so it falls through and rejects loudly rather than reaching the
 * Shell), and the stage rect it streams is rounded and clamped before it ever
 * reaches the browser.
 */

/** The channels the Shell actually drives, mapped onto the staged (active) tab. */
/** Real browser windows the Shell bridge opens for the Deck and floating stacks. */
const WINDOWS = [
  IpcChannels.windowNew,
  IpcChannels.deckOpen,
  IpcChannels.deckClose,
  IpcChannels.deckFocus,
  IpcChannels.shellReload,
  IpcChannels.floatSync
]

const PRIMARY = [
  IpcChannels.browserCreate,
  IpcChannels.browserNavigate,
  IpcChannels.browserSetBounds,
  IpcChannels.browserBack,
  IpcChannels.browserForward,
  IpcChannels.browserReload
]

/** Secondary browser controls the Shell drives beyond the primary staged tab. */
const SECONDARY = [
  IpcChannels.browserDestroy,
  IpcChannels.browserStop,
  IpcChannels.browserSetVisible,
  IpcChannels.browserSetCornerRadius,
  IpcChannels.browserCaptureStage,
  IpcChannels.browserDevTools,
  IpcChannels.browserFind,
  IpcChannels.browserFindStop,
  IpcChannels.browserZoom,
  IpcChannels.browserPrint,
  // Split view + Picture-in-Picture
  IpcChannels.browserSetSplit,
  IpcChannels.browserSetSecondaryBounds,
  IpcChannels.browserPictureInPicture,
  // Page Assistant: read the staged tab's visible text (roadmap A4)
  IpcChannels.browserGetPageText,
  // The toolbar the shell draws: pinned extension actions, and the signed-in
  // account behind the profile button. Both are the browser's own state.
  IpcChannels.extensionsActions,
  IpcChannels.extensionsRunAction,
  IpcChannels.profilesAccount,
  IpcChannels.browserOpenLocalFile,
  IpcChannels.browserGetSettingPrefs,
  IpcChannels.browserSetSettingPref,
  // Browser-preferences panel (privacy, cookies, default browser)
  IpcChannels.browserGetCookieBlock,
  IpcChannels.browserSetCookieBlock,
  IpcChannels.browserGetDnt,
  IpcChannels.browserSetDnt,
  IpcChannels.browserGetHttpsOnly,
  IpcChannels.browserSetHttpsOnly,
  IpcChannels.browserGetPreload,
  IpcChannels.browserSetPreload,
  IpcChannels.browserGetAdblock,
  IpcChannels.browserSetAdblock,
  IpcChannels.browserGetAdblockCount,
  IpcChannels.browserClearData,
  IpcChannels.browserDefaultStatus,
  IpcChannels.browserMakeDefault,
  // The native open panel that reports real paths (Shell.PickPaths)
  IpcChannels.dialogPickPaths,
  IpcChannels.dialogPickImage
]

describe('SHELL_BROWSER known-channel allowlist', () => {
  it('exposes every browser.* channel the window answers, and each is a function', () => {
    for (const channel of [...PRIMARY, ...SECONDARY]) {
      expect(typeof SHELL_BROWSER[channel]).toBe('function')
    }
  })

  it('is exactly the known list — no extra keys crept in', () => {
    expect(new Set(Object.keys(SHELL_BROWSER))).toEqual(
      new Set([...PRIMARY, ...SECONDARY, ...WINDOWS])
    )
  })

  it('does NOT contain unknown or core-owned channels', () => {
    // An unknown channel must be absent, so ipc-adapter lets it fall through to
    // the core rather than forwarding it to the Shell.
    expect(SHELL_BROWSER['browser:teleport']).toBeUndefined()
    expect(SHELL_BROWSER['totally:unknown']).toBeUndefined()
    // A core-owned channel is not the Shell's to answer.
    expect(SHELL_BROWSER[IpcChannels.appSettingsRead]).toBeUndefined()
    expect(SHELL_BROWSER[IpcChannels.workspaceOpen]).toBeUndefined()
  })

  it('a level-less zoom answers without a Shell (its documented no-Shell shape)', async () => {
    // zoom() with no level reads the cached level locally and never imports the
    // Mojo host, so it still answers even off-fork.
    await expect(SHELL_BROWSER[IpcChannels.browserZoom]()).resolves.toBe(0)
  })

  it('Shell-driven channels fail loudly off-fork, never silently', async () => {
    // Off the fork there is no Mojo host to import, so any channel that routes to
    // the Shell must REJECT (with a clear reason) rather than pretend it worked.
    const clearReason = /cannot reach the browser|Arcwel WebDeck build/
    await expect(
      SHELL_BROWSER[IpcChannels.browserNavigate](0, 'https://example.com')
    ).rejects.toThrow(clearReason)
    await expect(SHELL_BROWSER[IpcChannels.browserPrint]('t')).rejects.toThrow(clearReason)
    await expect(SHELL_BROWSER[IpcChannels.browserDestroy]('t')).rejects.toThrow(clearReason)
    await expect(SHELL_BROWSER[IpcChannels.browserStop]('t')).rejects.toThrow(clearReason)
  })
})

describe('toRect rounds and clamps the stage rect', () => {
  it('rounds every field to a whole pixel', () => {
    expect(toRect({ x: 1.4, y: 2.6, width: 10.5, height: 20.49 })).toEqual({
      x: 1,
      y: 3,
      width: 11,
      height: 20
    })
  })

  it('clamps negative width and height to 0, but keeps negative x/y', () => {
    expect(toRect({ x: -5.2, y: -0.6, width: -10, height: -1 })).toEqual({
      x: -5,
      y: -1,
      width: 0,
      height: 0
    })
  })

  it('treats missing, null, and non-numeric fields as 0', () => {
    expect(toRect(undefined)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(toRect(null)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(toRect({})).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(toRect({ x: 'nope', y: NaN, width: undefined, height: null })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })
})

describe('SHELL_BROWSER_EVENTS covers every channel the ShellClient emits', () => {
  // Read the source rather than the runtime: the ShellClient is built inside
  // ensureShellClient() and is unreachable from a test, but the set of channels
  // it emits on is written in plain sight as emitShellBrowserEvent(IpcEvents.X).
  // A channel emitted there and missing from SHELL_BROWSER_EVENTS is delivered
  // to nobody, because the adapter wires subscribers for it to the core socket
  // instead of the shell bus. Dropped documents were lost exactly this way.
  // A path, not import.meta.url: under the DOM test environment that URL is
  // http-scheme and node:fs refuses it.
  const source = readFileSync(join(process.cwd(), 'src', 'webui', 'shell.ts'), 'utf8')
  const emitted = [...source.matchAll(/emitShellBrowserEvent\(\s*IpcEvents\.(\w+)/g)].map(
    (m) => m[1]
  )

  it('finds the emit sites (the regex is not silently matching nothing)', () => {
    expect(emitted).toContain('browserDocumentsDropped')
    expect(emitted).toContain('browserCommand')
  })

  it.each([...new Set(emitted)])('routes IpcEvents.%s to the shell bus', (name) => {
    const channel = IpcEvents[name as keyof typeof IpcEvents]
    expect(channel, `IpcEvents.${name} does not exist`).toBeDefined()
    expect(SHELL_BROWSER_EVENTS.has(channel)).toBe(true)
  })
})
