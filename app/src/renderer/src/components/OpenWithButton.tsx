import { useCallback, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { usePopover } from '@/popover'
import { AnchoredPopover } from '@/components/AnchoredPopover'
import { customEditorsFor, openWithCustomEditor, type CustomEditorChoice } from '@/vscode-editors'

/**
 * "Open with…" on a file row: the editors installed extensions claim for it,
 * then the plain text editor. An extension's editor opens in VS Code's editor
 * area, placed by the setting — a stage tab, or the Editor block's tab.
 */
export function OpenWithButton({ path, name }: { path: string; name: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [choices, setChoices] = useState<CustomEditorChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // The trigger ref doubles as the popover's anchor; a press outside both closes it.
  const anchorRef = usePopover(open, close, panelRef)
  const openFile = useShellStore((s) => s.openFile)
  const openEditorsTab = useShellStore((s) => s.openEditorsTab)
  const showEditorsInDeck = useShellStore((s) => s.showEditorsInDeck)
  const workspace = useShellStore((s) => s.workspace)

  const absolute = path.startsWith('/') ? path : `${workspace?.path ?? ''}/${path}`

  const show = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setChoices(null)
    setChoices(await customEditorsFor(absolute))
  }

  const choose = async (choice: CustomEditorChoice | null): Promise<void> => {
    setOpen(false)
    if (!choice) {
      openFile(path)
      return
    }
    setError(null)
    try {
      const settings = await window.agweb.appSettings.read()
      if (settings.customEditorsOpenIn === 'deck') showEditorsInDeck()
      else openEditorsTab()
      await openWithCustomEditor(absolute, choice.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOpen(true)
    }
  }

  return (
    <>
      <span ref={anchorRef} className="contents">
        <button
          onClick={(e) => void show(e)}
          className="rounded px-1 text-[10px] text-slate-400 hover:text-sky-500"
          aria-label={`Open ${name} with…`}
          title="Open with…"
          data-testid="open-with"
        >
          ⋯
        </button>
      </span>
      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          panelRef={panelRef}
          width={240}
          className="rounded-lg border border-[var(--wd-glass-border)] bg-[var(--wd-glass)] p-1 text-xs shadow-xl"
          data-testid="open-with-menu"
        >
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--wd-dim)]">
            Open {name} with
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              void choose(null)
            }}
            className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--wd-hover)]"
          >
            Text editor
          </button>
          {choices === null ? (
            <div className="px-2 py-1 text-[var(--wd-dim)]">Looking…</div>
          ) : choices.length === 0 ? (
            <div className="px-2 py-1 text-[var(--wd-dim)]">
              No installed extension offers an editor for this file.
            </div>
          ) : (
            choices.map((c) => (
              <button
                key={c.id}
                onClick={(e) => {
                  e.stopPropagation()
                  void choose(c)
                }}
                className="block w-full rounded px-2 py-1 text-left hover:bg-[var(--wd-hover)]"
                title={c.detail}
                data-testid={`open-with-${c.id}`}
              >
                {c.label}
              </button>
            ))
          )}
          {error && <div className="px-2 py-1 text-rose-600 dark:text-rose-400">{error}</div>}
        </AnchoredPopover>
      )}
    </>
  )
}
