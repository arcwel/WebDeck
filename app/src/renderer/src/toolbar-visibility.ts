import { useEffect, useState } from 'react'
import { TOOLBAR_BUTTONS, sanitizeHiddenToolbarButtons } from '@shared/toolbar-buttons'
import { browserPrefs } from '../../webui/shell'

/**
 * Which toolbar buttons are on show.
 *
 * Two sources, because two owners. The action cluster is WebDeck's own, so its
 * hidden list lives in WebDeck's settings. The home button is Chromium's —
 * `browser.show_home_button` is the pref chrome://settings writes, and WebDeck
 * draws the button itself, so it has to read that pref or the setting is a
 * switch that moves and changes nothing.
 *
 * The hidden list is read at mount and again whenever the customize panel
 * announces a change, because that panel is its only writer.
 *
 * The home pref has no such announcement: it is written in `chrome://settings`,
 * a page of Chromium's that knows nothing about this one. So it is re-read when
 * the shell regains focus — coming back from that tab is exactly when the answer
 * can have changed, and it costs one Mojo call.
 */
const EVENT = 'webdeck:toolbar-changed'

export function notifyToolbarChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onToolbarChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export interface ToolbarVisibility {
  hidden: readonly string[]
  /** Chromium's `browser.show_home_button`; true until the pref is read. */
  showHome: boolean
  /** A button in the customizable cluster, by id. */
  shows: (id: string) => boolean
}

async function readHidden(): Promise<string[]> {
  try {
    return sanitizeHiddenToolbarButtons((await window.agweb.appSettings.read()).toolbarHidden)
  } catch {
    return []
  }
}

async function readShowHome(): Promise<boolean> {
  try {
    const [pref] = await browserPrefs.getSettingPrefs(['browser.show_home_button'])
    // Unregistered or unreadable: keep the button. A missing pref must not make
    // a control disappear.
    if (!pref || pref.unavailable || !pref.jsonValue) return true
    return JSON.parse(pref.jsonValue) !== false
  } catch {
    return true
  }
}

export function useToolbarVisibility(): ToolbarVisibility {
  const [hidden, setHidden] = useState<readonly string[]>([])
  const [showHome, setShowHome] = useState(true)

  useEffect(() => {
    let live = true
    const refresh = (): void => {
      void readHidden().then((next) => live && setHidden(next))
      void readShowHome().then((next) => live && setShowHome(next))
    }
    refresh()
    const off = onToolbarChanged(refresh)
    const onFocus = (): void => {
      void readShowHome().then((next) => live && setShowHome(next))
    }
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return { hidden, showHome, shows: (id) => !hidden.includes(id) }
}

/**
 * Writes run one at a time.
 *
 * Each change is a read of the stored list, an edit, and a write back. Two
 * toggles in the same tick both read the old list and the second write erases
 * the first — which is exactly what ticking three boxes quickly does. Chaining
 * them makes each read see the write before it.
 */
let writes: Promise<unknown> = Promise.resolve()

/** Hide or show one button, and tell every toolbar about it. */
export async function setToolbarButtonHidden(id: string, hide: boolean): Promise<void> {
  writes = writes
    .catch(() => undefined)
    .then(async () => {
      const hidden = new Set(await readHidden())
      if (hide) hidden.add(id)
      else hidden.delete(id)
      await window.agweb.appSettings.write({ toolbarHidden: [...hidden] })
      notifyToolbarChanged()
    })
  await writes
}

export async function resetToolbarButtons(): Promise<void> {
  writes = writes
    .catch(() => undefined)
    .then(async () => {
      await window.agweb.appSettings.write({ toolbarHidden: [] })
      notifyToolbarChanged()
    })
  await writes
}

export { TOOLBAR_BUTTONS }
