import { useEffect, useRef, useState } from 'react'
import { monaco } from '@/monaco'
import { useMonacoReady } from '@/monaco-ready'
import { useShellStore } from '@/store'
import { ColorSettings } from '@/components/ColorSettings'
import { ApplicationSettings } from '@/components/ApplicationSettings'
import { AiSettings } from '@/components/AiSettings'
import { SyncSettings } from '@/components/SyncSettings'
import { AboutSettings } from '@/components/AboutSettings'
import { KeybindingConflicts } from '@/components/KeybindingConflicts'

/**
 * Settings and keybindings (task 12.6).
 *
 * A JSON editor over the real VS Code configuration service, with the same two
 * scopes VS Code has: user settings apply everywhere, workspace settings live
 * in the project's `.vscode/settings.json` and win over them.
 *
 * Deliberately a text editor rather than a form of toggles. The settings
 * surface is enormous and mostly contributed by extensions, so a form would be
 * both incomplete and instantly stale — and editing the document is what makes
 * an existing VS Code configuration paste in and just work.
 */

type Scope =
  'application' | 'ai' | 'sync' | 'user' | 'workspace' | 'keybindings' | 'colors' | 'about'

const TABS: Array<{ scope: Scope; label: string; hint: string }> = [
  { scope: 'application', label: 'Application', hint: 'How WebDeck itself behaves.' },
  { scope: 'ai', label: 'AI', hint: 'Provider API keys for the agent.' },
  {
    scope: 'sync',
    label: 'Sync',
    hint: 'Sync settings across machines via a file you keep in your own cloud folder.'
  },
  { scope: 'user', label: 'Editor', hint: 'VS Code user settings; applies to every project.' },
  {
    scope: 'workspace',
    label: 'Workspace',
    hint: 'Saved to .vscode/settings.json; wins over user settings.'
  },
  { scope: 'keybindings', label: 'Keybindings', hint: 'A JSON array, same shape as VS Code.' },
  { scope: 'colors', label: 'Color', hint: 'Every color the app paints, as RGBA.' },
  {
    scope: 'about',
    label: 'About',
    hint: 'Version and the open-source components WebDeck is built on.'
  }
]

/**
 * WebDeck's own settings.
 *
 * This sheet used to carry a second side that redrew Chromium's settings from
 * the prefs behind them. A redrawing can only ever be a subset of the real
 * page, and it goes stale the moment upstream adds a row — so the menu now
 * opens `chrome://settings` itself, and what is left here is WebDeck's:
 * provider keys, the editor, keybindings, colours, sync, and the browsing
 * controls Chromium has no equivalent of.
 *
 * This split is a decision, not an accident, and it has been reversed once
 * before. Read SETTINGS_ARCHITECTURE.md before changing it.
 */

/** Scopes that render a bespoke panel instead of the JSON editor. */
const PANEL_SCOPES = ['application', 'ai', 'sync', 'colors', 'about'] as const
function isPanelScope(scope: Scope): boolean {
  return (PANEL_SCOPES as readonly string[]).includes(scope)
}

const PLACEHOLDER: Record<string, string> = {
  user: '{\n  "editor.fontSize": 13\n}\n',
  workspace: '{\n  "editor.tabSize": 4\n}\n',
  keybindings: '[\n  { "key": "ctrl+alt+f", "command": "editor.action.formatDocument" }\n]\n'
}

/** Scopes backed by a JSON document; Colours is a panel, not an editor. */
const EDITOR_SCOPES = ['user', 'workspace', 'keybindings'] as const

export function SettingsBlock(): React.JSX.Element {
  const [scope, setScope] = useState<Scope>('application')
  const [documents, setDocuments] = useState<Record<string, string> | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoReady = useMonacoReady()

  useEffect(() => {
    let live = true
    void window.agweb.settings.read().then((next) => {
      if (!live) return
      setDocuments({
        user: next.user,
        workspace: next.workspace,
        keybindings: next.keybindings
      })
    })
    return () => {
      live = false
    }
  }, [])

  // One editor whose model is swapped per tab, so switching tabs keeps unsaved
  // edits in the other two rather than discarding them. The models are held in
  // a ref because they must outlive a scope change but die with the editor.
  const modelsRef = useRef<Record<Scope, monaco.editor.ITextModel> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady || !documents) return

    const models = Object.fromEntries(
      EDITOR_SCOPES.map((scope) => [
        scope,
        monaco.editor.createModel(documents[scope] || PLACEHOLDER[scope], 'json')
      ])
    ) as Record<Scope, monaco.editor.ITextModel>
    modelsRef.current = models

    const editor = monaco.editor.create(container, { automaticLayout: true })
    editorRef.current = editor

    return () => {
      editorRef.current = null
      modelsRef.current = null
      editor.dispose()
      for (const model of Object.values(models)) model.dispose()
    }
  }, [monacoReady, documents])

  useEffect(() => {
    const model = modelsRef.current?.[scope]
    if (model) editorRef.current?.setModel(model)
  }, [scope, documents, monacoReady])

  const save = async (): Promise<void> => {
    const editor = editorRef.current
    // The panels (Application, AI, Colours) persist as you go — nothing to save
    // here, and this guard is what narrows `scope` to an editor scope below.
    if (!editor || isPanelScope(scope)) return
    const text = editor.getValue()
    const result = await window.agweb.settings.write(scope as (typeof EDITOR_SCOPES)[number], text)
    if (result.error) {
      setError(result.error)
      setStatus(null)
      return
    }
    setError(null)
    setStatus(scope === 'keybindings' ? 'Keybindings saved.' : 'Settings saved — reload to apply.')
    setTimeout(() => setStatus(null), 3000)
  }

  const importFile = async (): Promise<void> => {
    const result = await window.agweb.settings.import()
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.text !== undefined) {
      editorRef.current?.setValue(result.text)
      setError(null)
      setStatus('Imported — review, then Save.')
    }
  }

  const tab = TABS.find((t) => t.scope === scope)

  return (
    <div className="flex h-full flex-col text-xs">
      {/* Chromium's settings are Chromium's: the menu opens chrome://settings,
          the real page. This sheet is WebDeck's own. */}
      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-200">
          WebDeck
        </span>
        <span className="text-[10.5px] text-slate-400">
          WebDeck’s own settings. Chromium’s live at chrome://settings.
        </span>
        <button
          onClick={() => {
            useShellStore.getState().newTab('chrome://settings')
            useShellStore.getState().setSettingsOpen(false)
          }}
          className="ml-auto rounded-md border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          data-testid="settings-open-chrome"
        >
          Browser settings →
        </button>
      </div>
      <div className="flex flex-none items-center gap-1 border-b border-slate-200 px-2 dark:border-slate-800">
        {TABS.map((entry) => (
          <button
            key={entry.scope}
            onClick={() => setScope(entry.scope)}
            className={`h-7 px-2 text-[11px] font-semibold ${
              entry.scope === scope
                ? 'border-b-2 border-sky-500 text-slate-700 dark:text-slate-200'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
            data-testid={`settings-tab-${entry.scope}`}
          >
            {entry.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {!isPanelScope(scope) && (
            <button
              onClick={() => void importFile()}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              title="Import an existing VS Code settings.json or keybindings.json"
            >
              Import…
            </button>
          )}
          {!isPanelScope(scope) && (
            <button
              onClick={() => void save()}
              className="rounded bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-600"
              data-testid="settings-save"
            >
              Save
            </button>
          )}
        </div>
      </div>

      <Appearance />

      <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2.5 py-1 dark:border-slate-800">
        <span className="truncate text-[10px] text-slate-400">{tab?.hint}</span>
        {status && <span className="ml-auto flex-none text-[10px] text-emerald-500">{status}</span>}
        {error && (
          <span className="ml-auto flex-none truncate text-[10px] text-rose-500" title={error}>
            {error}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {scope === 'application' && <ApplicationSettings />}
        {scope === 'ai' && <AiSettings />}
        {scope === 'sync' && <SyncSettings />}
        {scope === 'colors' && <ColorSettings />}
        {scope === 'about' && <AboutSettings />}
        {scope === 'keybindings' && <KeybindingConflicts />}
        {/* The editor container is always in the DOM — only hidden behind a
            panel — so Monaco can be created once at mount. Rendering it
            conditionally meant that opening on a panel scope (the default) left
            the ref null, and the editor never appeared when you switched to an
            editor scope. */}
        <div
          ref={containerRef}
          className={isPanelScope(scope) ? 'hidden' : 'h-full'}
          data-testid="settings-editor"
        />
        {!isPanelScope(scope) && !documents && (
          <div className="p-4 text-[var(--wd-dim)]">Reading settings…</div>
        )}
      </div>
    </div>
  )
}

/**
 * Appearance.
 *
 * The theme was only reachable by a keyboard shortcut, which is fine once you
 * know it and invisible until then. It belongs in Settings, where someone
 * looking for it will actually look.
 */
function Appearance(): React.JSX.Element {
  const theme = useShellStore((s) => s.theme)
  const setTheme = useShellStore((s) => s.setTheme)

  return (
    <div className="flex flex-none items-center gap-2 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Appearance
      </span>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
        className="rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-sky-500 dark:border-slate-700"
        aria-label="Theme"
        data-testid="settings-theme"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <span className="ml-auto text-[10px] text-slate-400">⌘⇧L toggles</span>
    </div>
  )
}
