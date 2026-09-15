import {
  getService,
  IEditorResolverService,
  IEditorService
} from '@codingame/monaco-vscode-api/services'
import { registerAssets } from '@codingame/monaco-vscode-api/assets'
import {
  isEditorPartVisible,
  renderEditorPart
} from '@codingame/monaco-vscode-views-service-override'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'

/**
 * VS Code's editor area, for the editors WebDeck does not draw itself.
 *
 * Text files open in WebDeck's own Monaco editor. Everything else an extension
 * contributes — a hex editor, an image or diagram editor, a preview — is a
 * *custom editor*: a webview that VS Code's editor part hosts. There is one
 * editor part, so it is mounted in one place at a time: a stage tab, or the
 * Editor block's "Extension editors" tab, by the setting in Settings →
 * Application. `mountEditorPart` moves it; the editors inside survive the move.
 *
 * The webview host page and its service worker come from the bundle's assets,
 * re-pointed at the loopback origin the way the extension host's files are
 * (editor-extensions.ts): a webview iframe on chrome://webdeck would carry the
 * page's privileges, and one on the loopback origin carries none.
 */
const WEBVIEW_PRE = 'vs/workbench/contrib/webview/browser/pre/'

/** Serve the webview host from the loopback origin. Call once services are up. */
export function registerWebviewHost(origin: string): void {
  registerAssets({
    [`${WEBVIEW_PRE}index.html`]: `${origin}/assets/index.html`,
    [`${WEBVIEW_PRE}service-worker.js`]: `${origin}/assets/service-worker.js`,
    [`${WEBVIEW_PRE}fake.html`]: `${origin}/assets/fake.html`
  })
}

/** The one editor the workbench's default text editor registers under. */
const DEFAULT_EDITOR_ID = 'default'

export interface CustomEditorChoice {
  id: string
  label: string
  detail?: string
}

/** The editors installed extensions offer for a file, the plain text editor left out. */
export async function customEditorsFor(path: string): Promise<CustomEditorChoice[]> {
  try {
    const resolver = await getService(IEditorResolverService)
    return resolver
      .getEditors(URI.file(path))
      .filter((e) => e.id !== DEFAULT_EDITOR_ID)
      .map((e) => ({ id: e.id, label: e.label, detail: e.detail }))
  } catch {
    return []
  }
}

/**
 * Wait for the part to be on screen. The editor service opens into the part
 * only while it is visible; asked a moment before React has mounted it, the
 * open would fall back to WebDeck's text editor and the custom editor would
 * never show.
 */
export async function waitForEditorPart(timeoutMs = 3000): Promise<boolean> {
  const by = Date.now() + timeoutMs
  while (Date.now() < by) {
    if (isEditorPartVisible()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return isEditorPartVisible()
}

/** Open a file in one of those editors. The part must be mounted to show it. */
export async function openWithCustomEditor(path: string, editorId: string): Promise<void> {
  if (!(await waitForEditorPart())) {
    throw new Error('The editor area did not appear; try again.')
  }
  const editors = await getService(IEditorService)
  await editors.openEditor({
    resource: URI.file(path),
    options: { override: editorId, pinned: true }
  })
}

/** How many editors the part holds, and the active one's name. */
export async function editorPartState(): Promise<{ count: number; active: string | null }> {
  try {
    const editors = await getService(IEditorService)
    return { count: editors.count, active: editors.activeEditor?.getName() ?? null }
  } catch {
    return { count: 0, active: null }
  }
}

export function onEditorPartChanged(listener: () => void): () => void {
  let disposed = false
  const disposables: Array<{ dispose(): void }> = []
  void getService(IEditorService).then((editors) => {
    if (disposed) return
    disposables.push(editors.onDidActiveEditorChange(listener))
    disposables.push(editors.onDidEditorsChange(listener))
  })
  return () => {
    disposed = true
    for (const d of disposables) d.dispose()
  }
}

let mounted: { container: HTMLElement; dispose: () => void } | null = null
/** Where the part's DOM waits between mounts, so its editors are not torn down. */
const parking = document.createElement('div')

/**
 * Put the editor part into `container`, taking it from wherever it was.
 * Returns the unmount, which parks the part rather than disposing it.
 */
export function mountEditorPart(container: HTMLElement): () => void {
  if (mounted?.container === container) return mounted.dispose
  mounted?.dispose()
  const handle = renderEditorPart(container)
  const dispose = (): void => {
    if (mounted?.container !== container) return
    handle.dispose()
    for (const child of [...container.children]) parking.append(child)
    mounted = null
  }
  mounted = { container, dispose }
  return dispose
}
