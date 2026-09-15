import { useEffect, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { useMonacoReady } from '@/monaco-ready'
import { editorPartState, mountEditorPart, onEditorPartChanged } from '@/vscode-editors'

/**
 * VS Code's editor area as a stage tab: the custom editors installed
 * extensions contribute, full width, with their own tab strip inside. The one
 * WebDeck control is a way to send them to the Deck instead, which is the
 * setting in Settings → Application flipped from here.
 */
export function VscodeEditorsSurface(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const monacoReady = useMonacoReady()
  const [state, setState] = useState<{ count: number; active: string | null }>({
    count: 0,
    active: null
  })
  const showEditorsInDeck = useShellStore((s) => s.showEditorsInDeck)
  const closeTab = useShellStore((s) => s.closeTab)
  const activeTabId = useShellStore((s) => s.activeTabId)

  useEffect(() => {
    if (!monacoReady || !ref.current) return
    return mountEditorPart(ref.current)
  }, [monacoReady])

  useEffect(() => {
    if (!monacoReady) return
    let live = true
    const refresh = (): void => {
      void editorPartState().then((s) => {
        if (live) setState(s)
      })
    }
    refresh()
    const off = onEditorPartChanged(refresh)
    return () => {
      live = false
      off()
    }
  }, [monacoReady])

  const sendToDeck = (): void => {
    void window.agweb.appSettings.write({ customEditorsOpenIn: 'deck' })
    showEditorsInDeck()
    closeTab(activeTabId)
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#1e1e1e]" data-testid="editors-surface">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-slate-800 px-3 text-[11px] text-slate-400">
        <span className="truncate text-slate-200" data-testid="editors-active">
          {state.active ?? 'Extension editors'}
        </span>
        <span>
          {state.count === 0
            ? 'Nothing open. Choose Open with… on a file in the Files block.'
            : `${state.count} open`}
        </span>
        <button
          onClick={sendToDeck}
          className="ml-auto rounded border border-slate-700 px-2 py-0.5 hover:text-slate-100"
          title="Show extension editors as a tab in the Editor block instead (a setting)"
          data-testid="editors-send-to-deck"
        >
          Send to Deck
        </button>
      </div>
      <div ref={ref} className="min-h-0 flex-1 monaco-workbench" data-testid="editors-part" />
    </div>
  )
}
