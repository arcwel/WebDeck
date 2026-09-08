/**
 * A one-line signal that the model choice changed (Composer's picker, Settings
 * → AI). The Agents block's key banner re-reads the key/runtime status on it,
 * so switching to a local model — or back to Claude — updates the banner
 * without a remount.
 */
const EVENT = 'webdeck:models-changed'

export function notifyModelsChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onModelsChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
