// Default VS Code extensions. These carry the TextMate grammars and language
// configurations, so highlighting, bracket matching and comment toggling are
// VS Code's own rather than Monaco's simplified monarch versions.
//
// Each registers itself on import and resolves `whenReady` once its
// contributions are live. They are awaited rather than fire-and-forget: a model
// opened before its grammar is registered stays untokenized, because nothing
// re-runs tokenization when a language shows up later.
import { whenReady as themeReady } from '@codingame/monaco-vscode-theme-defaults-default-extension'
import { whenReady as tsReady } from '@codingame/monaco-vscode-typescript-basics-default-extension'
import { whenReady as jsReady } from '@codingame/monaco-vscode-javascript-default-extension'
import { whenReady as jsonReady } from '@codingame/monaco-vscode-json-default-extension'
import { whenReady as cssReady } from '@codingame/monaco-vscode-css-default-extension'
import { whenReady as htmlReady } from '@codingame/monaco-vscode-html-default-extension'
import { whenReady as pyReady } from '@codingame/monaco-vscode-python-default-extension'
import { whenReady as mdReady } from '@codingame/monaco-vscode-markdown-basics-default-extension'
import { whenReady as yamlReady } from '@codingame/monaco-vscode-yaml-default-extension'
import { whenReady as shReady } from '@codingame/monaco-vscode-shellscript-default-extension'
import { whenReady as xmlReady } from '@codingame/monaco-vscode-xml-default-extension'
import { whenReady as iniReady } from '@codingame/monaco-vscode-ini-default-extension'

import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TextMateWorker from '@codingame/monaco-vscode-textmate-service-override/worker?worker'
import { initialize as initializeVscodeServices } from '@codingame/monaco-vscode-api'
import { registerWebviewHost } from '@/vscode-editors'
import { registerWorkspaceFileSystem } from '@/workspace-fs-provider'
import getConfigurationServiceOverride, {
  updateUserConfiguration
} from '@codingame/monaco-vscode-configuration-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getFilesServiceOverride from '@codingame/monaco-vscode-files-service-override'
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getViewsServiceOverride, {
  type OpenEditor
} from '@codingame/monaco-vscode-views-service-override'
import { updateUserKeybindings } from '@codingame/monaco-vscode-keybindings-service-override'
import {
  extensionHostFileUrl,
  extensionHostOrigin,
  extensionHostWorkerOptions,
  loadInstalledExtensions
} from '@/editor-extensions'

/**
 * The editor foundation (task 12.1).
 *
 * `monaco-editor` is aliased in package.json to `@codingame/monaco-vscode-editor-api`,
 * which exposes the same API over VS Code's real service layer. That means every
 * existing `import { monaco } from '@/monaco'` keeps working while the services
 * underneath — configuration, keybindings, theme, quick access, languages,
 * TextMate, files — become VS Code's own instead of Monaco's standalone stubs.
 *
 * `PRD.md` named Code - OSS as the IDE base; only the editor component had been
 * adopted. This is the seam that closes that gap without the browser-first shell
 * having to give the window over to a workbench. See `IDE_FOUNDATION.md`.
 *
 * Workers: only the core editor worker is bundled now. Monaco's per-language
 * workers are gone by design — language intelligence comes from real language
 * servers (task 12.2), not from the browser-side stubs.
 */

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // TextMate tokenizes on its own worker so a large file does not block the
    // UI thread; without this it falls back to synchronous tokenization and
    // logs a channel error on every editor.
    if (label === 'TextMateWorker') return new TextMateWorker()
    return new EditorWorker()
  },
  // The extension host's iframe page and worker come from the core's loopback
  // origin, not this one (task 12.8). This is the seam the web-worker service
  // checks first; undefined means "use the bundled URL", which is right for
  // every other label.
  getWorkerUrl(_workerId: string, label: string): string | undefined {
    return extensionHostFileUrl(label)
  },
  getWorkerOptions(_workerId: string, label: string): WorkerOptions | undefined {
    return extensionHostWorkerOptions(label)
  }
}

/**
 * Services must be initialized exactly once, and before the first editor is
 * created. Every consumer awaits this instead of racing it.
 */
/**
 * What VS Code's view layer does when something asks it to "open an editor" —
 * an extension revealing a file from a tree view, a go-to-definition into
 * another file. WebDeck has no VS Code editor part; files open in the Editor
 * block, so route there. The store is imported lazily to keep this module
 * free of a static cycle.
 */
const openEditorFallback: OpenEditor = async (modelRef, options) => {
  const uri = modelRef.object.textEditorModel.uri
  // A text-editor open carries a selection (ITextEditorOptions); the base
  // IEditorOptions does not declare it, so read it defensively.
  const line = (options as { selection?: { startLineNumber?: number } } | undefined)?.selection
    ?.startLineNumber
  const { useShellStore } = await import('@/store')
  useShellStore.getState().openFile(uri.fsPath, line)
  modelRef.dispose()
  return undefined
}

/**
 * `window.agweb` once main.tsx has installed it.
 *
 * This chain starts at module load — App imports this file, and main.tsx
 * imports App — which is BEFORE main.tsx has connected to the core and put the
 * API on the window. VS Code's services usually boot slower than that
 * connection, but not always: on a slow core start they win, the settings read
 * below finds no `window.agweb`, the promise rejects, and every editor in the
 * app is dead for the session with one console line to show for it. Waiting
 * for the API here is what makes the order irrelevant.
 */
function agwebInstalled(): Promise<typeof window.agweb> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (window.agweb) resolve(window.agweb)
      else setTimeout(check, 50)
    }
    check()
  })
}

export const monacoReady: Promise<void> = extensionHostOrigin()
  .then((extHostOrigin) =>
    initializeVscodeServices({
      // Third-party extension code runs in VS Code's web-worker host, inside an
      // iframe on the loopback origin — never in chrome://webdeck, the page that
      // holds the core token (task 12.8, SECURITY.md). If that origin cannot be
      // provided the worker host stays OFF and only declarative extensions
      // (themes, grammars, snippets, keymaps) load.
      ...getExtensionsServiceOverride({ enableWorkerExtensionHost: extHostOrigin !== null }),
      ...getFilesServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getKeybindingsServiceOverride(),
      ...getThemeServiceOverride(),
      ...getQuickAccessServiceOverride(),
      ...getLanguagesServiceOverride(),
      ...getTextmateServiceOverride(),
      // VS Code's view layer, so extension view containers can be rendered
      // inside Deck blocks (12.8, editor-views.ts). The webview alternate
      // domain is deliberately NOT set: the override's domain rewrite only
      // swaps the hostname, which cannot express chrome:// → http://loopback;
      // webview panels get the same registerAssets-style redirect as the
      // extension host when they land (step 6).
      ...getViewsServiceOverride(openEditorFallback)
    }).then(() => {
      // Webview host files on the loopback origin, beside the extension host's
      // (vscode-editors.ts). Without the origin there is no host and custom
      // editors stay off, like extension code.
      if (extHostOrigin) registerWebviewHost(extHostOrigin)
      // The workspace's files, for everything that reads through VS Code's
      // file service rather than WebDeck's blocks (workspace-fs-provider.ts).
      registerWorkspaceFileSystem()
    })
  )
  .then(() =>
    Promise.all([
      themeReady(),
      tsReady(),
      jsReady(),
      jsonReady(),
      cssReady(),
      htmlReady(),
      pyReady(),
      mdReady(),
      yamlReady(),
      shReady(),
      xmlReady(),
      iniReady()
    ])
  )
  .then(() => applySettings())
  // Persisted user + workspace settings and keybindings (12.6). Applied after
  // the defaults so a saved preference wins, and awaited as part of
  // monacoReady so the first editor is created with them already in force.
  .then(async () => {
    const stored = await (await agwebInstalled()).settings.read()
    const merged = parseSettingsText(stored.user)
    Object.assign(settings, merged, parseSettingsText(stored.workspace))
    applySettings()
    if (stored.keybindings.trim()) {
      await updateUserKeybindings(stored.keybindings).catch(() => {
        // Malformed keybindings must not stop the editor from starting.
      })
    }
  })
  // Installed editor extensions (12.8) — after settings, so a theme one of
  // them contributes can be the theme the user's settings select.
  .then(async () => {
    await loadInstalledExtensions()
  })

/**
 * The user settings document (task 12.1).
 *
 * `updateUserConfiguration` writes settings.json wholesale, so every change
 * goes through this object and rewrites the merged whole — patching one key by
 * passing it alone would silently drop the rest.
 */
const settings: Record<string, unknown> = {
  'editor.fontSize': 13,
  'editor.lineNumbers': 'on',
  'editor.minimap.enabled': false,
  'editor.renderWhitespace': 'selection',
  'editor.tabSize': 2,
  'editor.bracketPairColorization.enabled': true,
  'editor.guides.bracketPairs': true,
  'editor.stickyScroll.enabled': true,
  'editor.scrollBeyondLastLine': false,
  'editor.wordWrap': 'off',
  // Folding, multi-cursor and column selection are VS Code defaults; they are
  // listed rather than assumed so the view menu has something to toggle and so
  // a future settings UI (12.6) shows the real state.
  'editor.folding': true,
  'editor.showFoldingControls': 'mouseover',
  'editor.multiCursorModifier': 'alt',
  'editor.columnSelection': false,
  'files.autoSave': 'off',
  'workbench.colorTheme': 'Default Light Modern',
  // The theme used for each shell scheme — VS Code's own keys. The light/dark
  // toggle switches between THESE rather than resetting to the defaults, so a
  // theme installed from Open VSX (12.8) stays chosen across toggles and
  // relaunches. Settings › Colors › Editor theme edits them.
  'workbench.preferredDarkColorTheme': 'Default Dark Modern',
  'workbench.preferredLightColorTheme': 'Default Light Modern'
}

/**
 * Parse a settings document, tolerating the comments VS Code allows.
 *
 * Anything unparseable yields no overrides rather than throwing: a typo in
 * settings.json should leave the editor on defaults, not refuse to start.
 */
function parseSettingsText(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    const parsed = JSON.parse(stripped) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function applySettings(): void {
  updateUserConfiguration(JSON.stringify(settings))
}

/** Change one or more VS Code settings and re-apply the merged document. */
export async function updateSettings(patch: Record<string, unknown>): Promise<void> {
  await monacoReady
  Object.assign(settings, patch)
  applySettings()
  // Persist, so a toggle survives a relaunch (12.6).
  void window.agweb.settings.write('user', JSON.stringify(settings, null, 2))
  for (const notify of settingsSubscribers) notify()
}

/** Read one setting's current value. */
export function getSetting<T>(key: string): T | undefined {
  return settings[key] as T | undefined
}

const settingsSubscribers = new Set<() => void>()

/** Subscribe to settings changes, so UI toggles reflect the real state. */
export function onSettingsChanged(listener: () => void): () => void {
  settingsSubscribers.add(listener)
  return () => {
    settingsSubscribers.delete(listener)
  }
}

/**
 * Switch the editor theme (task 12.1).
 *
 * Not `monaco.editor.setTheme`: that selects one of Monaco's standalone themes,
 * and TextMate tokenization only colours against a real VS Code theme — with a
 * standalone theme selected the grammars still run but every token comes out
 * unstyled. `workbench.colorTheme` is what the theme service reads.
 */
export async function setEditorTheme(theme: 'light' | 'dark'): Promise<void> {
  // The user's preferred theme for this scheme (see the defaults above) — never
  // a hard-coded default, which silently discarded an installed theme.
  const key =
    theme === 'dark' ? 'workbench.preferredDarkColorTheme' : 'workbench.preferredLightColorTheme'
  const fallback = theme === 'dark' ? 'Default Dark Modern' : 'Default Light Modern'
  const preferred = settings[key]
  await updateSettings({
    'workbench.colorTheme': typeof preferred === 'string' && preferred ? preferred : fallback
  })
}

const EXT_LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  py: 'python',
  go: 'go',
  rs: 'rust',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  sh: 'shellscript',
  svg: 'xml',
  xml: 'xml'
}

export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANGUAGES[ext] ?? 'plaintext'
}

export { monaco }

/**
 * Workspace root, cached for URI construction.
 *
 * Models are addressed by real `file://` URIs rather than a private scheme:
 * language servers resolve documents by path, and a made-up scheme is a
 * document they cannot open (task 12.2).
 */
let workspaceRoot: string | null = null

export async function ensureWorkspaceRoot(): Promise<string | null> {
  if (workspaceRoot) return workspaceRoot
  const { useShellStore } = await import('@/store')
  workspaceRoot = useShellStore.getState().workspace?.path ?? null
  return workspaceRoot
}

/** Absolute file URI for a workspace-relative path. */
export function uriForPath(root: string, path: string): monaco.Uri {
  return monaco.Uri.file(`${root.replace(/\/$/, '')}/${path}`)
}

/** The workspace-relative path a model was created for. */
export function pathOfModel(model: monaco.editor.ITextModel): string {
  const full = model.uri.path
  // Inside the primary root, callers expect the relative path they opened.
  // Outside it — a file in another granted root — the absolute path *is* the
  // identifier, and relativizing it against the primary root would be wrong.
  if (workspaceRoot && (full === workspaceRoot || full.startsWith(workspaceRoot + '/'))) {
    return full.slice(workspaceRoot.length).replace(/^\//, '')
  }
  return model.uri.scheme === 'file' ? full : full.replace(/^\//, '')
}

/** Get or create the shared document model for a workspace file. */
export async function ensureModel(path: string): Promise<monaco.editor.ITextModel | null> {
  await monacoReady
  const root = await ensureWorkspaceRoot()
  // An absolute path is a file in one of the other granted roots (3B.4); it
  // already names itself, so it must not be joined onto the primary root.
  const uri = path.startsWith('/')
    ? monaco.Uri.file(path)
    : root
      ? uriForPath(root, path)
      : monaco.Uri.from({ scheme: 'agweb', path: `/${path}` })
  const existing = monaco.editor.getModel(uri)
  if (existing) return existing
  const result = await window.agweb.fs.read(path)
  if (result.content === undefined) return null
  const model = monaco.editor.createModel(result.content, languageForPath(path), uri)
  model.onDidChangeContent(() => {
    void import('@/store').then(({ useShellStore }) =>
      useShellStore.getState().setFileDirty(path, true)
    )
  })
  return model
}
