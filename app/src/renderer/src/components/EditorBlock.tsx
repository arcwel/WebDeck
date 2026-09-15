import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ensureModel,
  getSetting,
  languageForPath,
  monaco,
  onSettingsChanged,
  pathOfModel,
  setEditorTheme,
  updateSettings
} from '@/monaco'
import { EditorBreadcrumbs } from '@/components/EditorBreadcrumbs'
import { InlineEdit, type InlineEditParams } from '@/components/InlineEdit'
import { usePopover } from '@/popover'
import { ensureLanguageClient } from '@/lsp'
import { useMonacoReady } from '@/monaco-ready'
import { useShellStore } from '@/store'
import { mountEditorPart } from '@/vscode-editors'
import { canFormat, formatModel } from '@/format'
import { CloseIcon } from '@/components/icons'

/**
 * Monaco-backed editor. Documents are Monaco models keyed by workspace path
 * (shared by every editor instance in this window); the open-tab list and
 * focused document live in the store, synced across windows. ⌘S saves,
 * ⇧⌥F formats (Prettier), and Diff compares the buffer against disk.
 */

export function EditorBlock(): React.JSX.Element {
  const editorTabs = useShellStore((s) => s.editorTabs)
  const activePath = useShellStore((s) => s.activeEditorPath)
  const pendingRevealLine = useShellStore((s) => s.pendingRevealLine)
  const dirtyFiles = useShellStore((s) => s.dirtyFiles)
  const theme = useShellStore((s) => s.theme)
  const openFile = useShellStore((s) => s.openFile)
  const closeEditorTab = useShellStore((s) => s.closeEditorTab)
  // VS Code's editor area as one more tab, when the setting puts custom
  // editors in the Deck (vscode-editors.ts). The Monaco surface stays mounted
  // underneath and is hidden, so switching back costs nothing.
  const editorsInDeck = useShellStore((s) => s.editorsInDeck)
  const editorsTabActive = useShellStore((s) => s.editorsTabActive)
  const setEditorsTabActive = useShellStore((s) => s.setEditorsTabActive)
  const closeEditorsInDeck = useShellStore((s) => s.closeEditorsInDeck)
  const partRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editorsInDeck || !editorsTabActive || !partRef.current) return
    return mountEditorPart(partRef.current)
  }, [editorsInDeck, editorsTabActive])
  const breakpoints = useShellStore((s) => s.breakpoints)
  const [formatError, setFormatError] = useState<string | null>(null)
  // Cursor line and model URI drive the breadcrumb; both come from the editor
  // rather than from tab state, which briefly disagrees during a model swap.
  const [cursorLine, setCursorLine] = useState(1)
  const [modelUri, setModelUri] = useState<string | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  // The active inline AI edit (⌘I), or null. Non-destructive: it only becomes a
  // buffer change when the user accepts the streamed proposal (roadmap A3). The
  // editor instance is captured here (not read from the ref during render) so
  // the overlay has it without a render-time ref access.
  const [inlineEdit, setInlineEdit] = useState<{
    editor: monaco.editor.IStandaloneCodeEditor
    params: InlineEditParams
    /** The file this edit was opened on; the overlay unmounts when it changes. */
    path: string
  } | null>(null)
  const monacoReady = useMonacoReady()

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // The ⌘I command is registered once on the editor, but must call the latest
  // opener (which sets React state); a ref bridges the two without re-registering.
  const openInlineEditRef = useRef<(() => void) | null>(null)

  const openInlineEdit = useCallback((): void => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection) return
    // No selection: fall back to the current line (constraint 4).
    const range = selection.isEmpty()
      ? new monaco.Range(
          selection.startLineNumber,
          1,
          selection.startLineNumber,
          model.getLineMaxColumn(selection.startLineNumber)
        )
      : new monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        )
    const originalText = model.getValueInRange(range)
    // An empty line with no selection has nothing to edit — no-op.
    if (!originalText.trim()) return
    setInlineEdit({
      editor,
      path: pathOfModel(model),
      params: {
        editId: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        range,
        originalText,
        language: model.getLanguageId()
      }
    })
  }, [])

  // Keep the ref pointing at the latest opener for the once-registered command.
  useEffect(() => {
    openInlineEditRef.current = openInlineEdit
  }, [openInlineEdit])

  const runFormat = async (): Promise<void> => {
    const model = editorRef.current?.getModel()
    if (!model) return
    const error = await formatModel(pathOfModel(model), model)
    setFormatError(error)
    if (!error) setTimeout(() => setFormatError(null), 1)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady) return
    // No per-editor appearance options: the VS Code configuration service is
    // the single source of truth for those now (12.1), so passing them here
    // would silently outrank settings.json and make the view toggles inert.
    // glyphMargin is what breakpoints (12.4) are clicked and drawn in.
    const editor = monaco.editor.create(container, { automaticLayout: true, glyphMargin: true })

    // A click in the glyph margin toggles a breakpoint on that line.
    const onGutter = editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const line = e.target.position?.lineNumber
      const model = editor.getModel()
      if (!line || !model) return
      useShellStore.getState().toggleBreakpoint(pathOfModel(model), line)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // The path must come from the mounted model, not the active-tab state:
      // during the async model swap after a tab switch they briefly disagree,
      // and writing tab B's path with tab A's model would destroy B on disk.
      const model = editor.getModel()
      if (!model) return
      const path = pathOfModel(model)
      void window.agweb.fs.write(path, model.getValue()).then((result) => {
        if (!result.error) useShellStore.getState().setFileDirty(path, false)
      })
    })
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      void runFormat()
    })
    // ⌘I / Ctrl+I opens the inline AI edit on the selection (roadmap A3). ⌘I is
    // free in base Monaco (⌘K is deliberately avoided — it is a chord prefix for
    // fold/comment bindings). Registered as an action so it also lands in the
    // context menu under the modification group.
    editor.addAction({
      id: 'agweb.inlineEdit',
      label: 'AI: Edit Selection…',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      contextMenuGroupId: 'modification',
      contextMenuOrder: 1.5,
      run: () => openInlineEditRef.current?.()
    })
    const onCursor = editor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber))
    const onModel = editor.onDidChangeModel(() =>
      setModelUri(editor.getModel()?.uri.toString() ?? null)
    )

    editorRef.current = editor
    return () => {
      onGutter.dispose()
      onCursor.dispose()
      onModel.dispose()
      editorRef.current = null
      editor.dispose()
    }
    // The editor instance is created once the services are up; theme below.
  }, [monacoReady])

  useEffect(() => {
    if (!monacoReady) return
    void setEditorTheme(theme)
  }, [theme, monacoReady])

  // Breakpoint decorations (12.4). Held in a collection so each redraw
  // replaces the previous one rather than stacking decorations up.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activePath) return
    const lines = breakpoints[activePath] ?? []
    const collection = editor.createDecorationsCollection(
      lines.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'agweb-breakpoint',
          glyphMarginHoverMessage: { value: 'Breakpoint' }
        }
      }))
    )
    return () => collection.clear()
  }, [breakpoints, activePath, modelUri, monacoReady])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!activePath) {
      editor.setModel(null)
      return
    }
    // Start this file's language server alongside opening it. It is deliberately
    // not awaited: IntelliSense arriving a moment later is fine, a file that
    // will not open until a server starts is not.
    void ensureLanguageClient(languageForPath(activePath))

    let cancelled = false
    void ensureModel(activePath).then((model) => {
      if (cancelled || !model || !editorRef.current) return
      editorRef.current.setModel(model)
      const line = useShellStore.getState().pendingRevealLine
      if (line) {
        editorRef.current.revealLineInCenter(line)
        editorRef.current.setPosition({ lineNumber: line, column: 1 })
        useShellStore.getState().clearPendingReveal()
      }
    })
    return () => {
      cancelled = true
    }
  }, [activePath, pendingRevealLine, monacoReady])

  return (
    <div className="flex h-full flex-col">
      {(editorTabs.length > 0 || editorsInDeck) && (
        <div className="flex h-8 flex-none items-center gap-px overflow-x-auto border-b border-slate-200 px-1 dark:border-slate-800">
          {editorsInDeck && (
            <div
              onClick={() => setEditorsTabActive(true)}
              className={`group flex h-full cursor-pointer items-center gap-1.5 px-2.5 text-xs ${
                editorsTabActive
                  ? 'border-b-2 border-sky-500 text-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
              title="Custom editors from extensions"
              data-testid="editor-tab-extension-editors"
            >
              <span>Extension editors</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeEditorsInDeck()
                }}
                className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-700"
                aria-label="Close Extension editors"
              >
                <CloseIcon size={10} />
              </button>
            </div>
          )}
          {editorTabs.map((path) => {
            const name = path.split('/').pop() ?? path
            return (
              <div
                key={path}
                onClick={() => openFile(path)}
                className={`group flex h-full cursor-pointer items-center gap-1.5 px-2.5 text-xs ${
                  path === activePath && !editorsTabActive
                    ? 'border-b-2 border-sky-500 text-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
                title={path}
              >
                <span>{name}</span>
                {dirtyFiles[path] && <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    closeEditorTab(path)
                  }}
                  className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-700"
                  aria-label={`Close ${name}`}
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            )
          })}
          <div className="ml-auto flex items-center gap-1 pr-1">
            {formatError && (
              <span className="max-w-64 truncate text-[10px] text-red-500" title={formatError}>
                {formatError}
              </span>
            )}
            {activePath && canFormat(activePath) && (
              <button
                onClick={() => void runFormat()}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                title="Format with Prettier (⇧⌥F)"
              >
                Format
              </button>
            )}
            {activePath && (
              <button
                onClick={() => setDiffOpen(true)}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                title="Compare the buffer with the saved file"
              >
                Diff
              </button>
            )}
            <ViewMenu />
          </div>
        </div>
      )}
      {activePath && modelUri && (
        <EditorBreadcrumbs
          path={activePath}
          uri={modelUri}
          line={cursorLine}
          onReveal={(line) => {
            const editor = editorRef.current
            if (!editor) return
            editor.revealLineInCenter(line)
            editor.setPosition({ lineNumber: line, column: 1 })
            editor.focus()
          }}
        />
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" hidden={editorsTabActive} />
        {editorsInDeck && editorsTabActive && (
          <div
            ref={partRef}
            className="monaco-workbench absolute inset-0"
            data-testid="editors-part-deck"
          />
        )}
        {!activePath && !editorsTabActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-slate-500 dark:bg-[#0e1420]">
            Select a file in Files to start editing.
          </div>
        )}
        {diffOpen && activePath && (
          <DiffOverlay path={activePath} onClose={() => setDiffOpen(false)} />
        )}
        {inlineEdit && inlineEdit.path === activePath && (
          <InlineEdit
            editor={inlineEdit.editor}
            params={inlineEdit.params}
            onClose={() => setInlineEdit(null)}
          />
        )}
      </div>
    </div>
  )
}

/** Side-by-side diff: saved file on disk (left) vs the live buffer (right). */
function DiffOverlay({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const monacoReady = useMonacoReady()

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady) return
    const diff = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: false,
      originalEditable: false,
      renderSideBySide: true,
      fontSize: 12
    })
    // Closing the overlay before the read resolves would otherwise call
    // setModel on a disposed editor and orphan the model it just created.
    let cancelled = false
    let original: monaco.editor.ITextModel | null = null
    void Promise.all([window.agweb.fs.read(path), ensureModel(path)]).then(
      ([diskResult, bufferModel]) => {
        if (!bufferModel) return
        const model = monaco.editor.createModel(
          diskResult.content ?? '',
          bufferModel.getLanguageId()
        )
        if (cancelled) {
          model.dispose()
          return
        }
        original = model
        diff.setModel({ original: model, modified: bufferModel })
      }
    )
    return () => {
      cancelled = true
      diff.dispose()
      original?.dispose()
    }
  }, [path, monacoReady])

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-[#0e1420]">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-slate-200 px-3 text-xs dark:border-slate-800">
        <span className="font-semibold">Diff</span>
        <span className="text-slate-500">saved on disk ⟷ current buffer · {path}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close diff"
        >
          <CloseIcon />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}

/**
 * View toggles (task 12.7).
 *
 * These write VS Code settings rather than editor constructor options, so one
 * toggle applies to every editor in every window and survives a reload — which
 * is only possible now that the configuration service is real (12.1).
 */
const VIEW_TOGGLES: Array<{ key: string; label: string; on: unknown; off: unknown }> = [
  { key: 'editor.minimap.enabled', label: 'Minimap', on: true, off: false },
  { key: 'editor.stickyScroll.enabled', label: 'Sticky scroll', on: true, off: false },
  { key: 'editor.wordWrap', label: 'Word wrap', on: 'on', off: 'off' },
  { key: 'editor.folding', label: 'Folding', on: true, off: false },
  { key: 'editor.columnSelection', label: 'Column selection', on: true, off: false },
  { key: 'editor.renderWhitespace', label: 'Whitespace', on: 'all', off: 'selection' }
]

function ViewMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [, bump] = useState(0)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  // Settings live outside React, so re-render when any of them changes.
  useEffect(() => onSettingsChanged(() => bump((n) => n + 1)), [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
        title="Editor view options"
        data-testid="editor-view-menu"
      >
        View
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[11px] shadow-lg dark:border-slate-700 dark:bg-slate-900"
          data-testid="editor-view-options"
        >
          {VIEW_TOGGLES.map((toggle) => {
            const active = getSetting(toggle.key) === toggle.on
            return (
              <button
                key={toggle.key}
                onClick={() =>
                  void updateSettings({ [toggle.key]: active ? toggle.off : toggle.on })
                }
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span className="w-3 flex-none text-sky-500">{active ? '✓' : ''}</span>
                {toggle.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
