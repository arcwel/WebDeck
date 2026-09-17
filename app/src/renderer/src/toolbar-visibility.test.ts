import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Two toolbar settings, two owners, and both have bitten already.
 *
 * The hidden list is a read-modify-write against a settings file. Ticking three
 * boxes in quick succession used to leave one hidden: each write read the list
 * before the previous one landed, so the last writer erased the rest. That is
 * what the queue in setToolbarButtonHidden exists to prevent, and it is only
 * provable by issuing writes without awaiting them in between.
 *
 * The home button is Chromium's pref, written on `chrome://settings` — a page
 * that cannot announce anything to this one. So the only way back is a re-read
 * when the shell regains focus, and a pref this build does not register must
 * leave the button alone rather than hide it.
 */

const prefs = { getSettingPrefs: vi.fn() }
vi.mock('../../webui/shell', () => ({
  get browserPrefs() {
    return prefs
  }
}))

/** A settings store that answers reads slowly enough to overlap writes. */
function installSettings(initial: string[] = []): { current: () => string[] } {
  let stored = { toolbarHidden: [...initial] }
  const later = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), 5))
  ;(window as unknown as { agweb: unknown }).agweb = {
    appSettings: {
      read: () => later({ ...stored, toolbarHidden: [...stored.toolbarHidden] }),
      write: (patch: { toolbarHidden?: string[] }) =>
        later(undefined).then(() => {
          stored = { ...stored, ...patch }
          return stored
        })
    }
  }
  return { current: () => stored.toolbarHidden }
}

describe('the toolbar visibility settings', () => {
  beforeEach(() => {
    vi.resetModules()
    prefs.getSettingPrefs.mockReset()
  })

  it('keeps every hide when three are issued at once', async () => {
    const settings = installSettings()
    const { setToolbarButtonHidden } = await import('./toolbar-visibility')

    // Deliberately not awaited in turn: this is the shape of a person ticking
    // three boxes faster than the file can be written.
    await Promise.all([
      setToolbarButtonHidden('reader', true),
      setToolbarButtonHidden('find', true),
      setToolbarButtonHidden('split', true)
    ])

    expect([...settings.current()].sort()).toEqual(['find', 'reader', 'split'])
  })

  it('un-hides without dropping the others', async () => {
    const settings = installSettings(['reader', 'find', 'split'])
    const { setToolbarButtonHidden } = await import('./toolbar-visibility')

    await Promise.all([
      setToolbarButtonHidden('find', false),
      setToolbarButtonHidden('reader', false)
    ])

    expect(settings.current()).toEqual(['split'])
  })

  it('shows every button again on reset', async () => {
    const settings = installSettings(['reader', 'find'])
    const { resetToolbarButtons } = await import('./toolbar-visibility')

    await resetToolbarButtons()

    expect(settings.current()).toEqual([])
  })

  it('tells listeners when a write lands', async () => {
    installSettings()
    const { setToolbarButtonHidden, onToolbarChanged } = await import('./toolbar-visibility')
    const heard = vi.fn()
    const off = onToolbarChanged(heard)

    await setToolbarButtonHidden('zoom', true)

    expect(heard).toHaveBeenCalledTimes(1)
    off()
    await setToolbarButtonHidden('pip', true)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
