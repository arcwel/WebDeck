import { TOOLBAR_BUTTONS } from '@shared/toolbar-buttons'
import {
  resetToolbarButtons,
  setToolbarButtonHidden,
  useToolbarVisibility
} from '@/toolbar-visibility'

/**
 * Customize toolbar: which of the action buttons are on show.
 *
 * The list is every button that may be hidden, in the order they sit in the
 * toolbar. Nothing here can hide navigation, the address bar, the menu, the
 * profile button or the Deck toggle — and a hidden button is still in the ⋮
 * menu, so turning one off never puts it out of reach.
 *
 * Used twice: from the toolbar's own right-click menu, and inline in
 * Settings → Application → Browsing.
 */
export function CustomizeToolbar({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { hidden } = useToolbarVisibility()
  return (
    <div
      className={compact ? 'flex flex-col gap-0.5 p-1' : 'flex flex-col gap-0.5'}
      data-testid="customize-toolbar"
    >
      {TOOLBAR_BUTTONS.map((button) => {
        const shown = !hidden.includes(button.id)
        return (
          <label
            key={button.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--wd-hover)]"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--wd-accent)]"
              checked={shown}
              onChange={(e) => void setToolbarButtonHidden(button.id, !e.target.checked)}
              data-testid={`toolbar-button-${button.id}`}
            />
            <span className="min-w-0">
              <span className="block font-medium text-[var(--wd-text)]">{button.label}</span>
              {!compact && (
                <span className="block text-[11px] text-[var(--wd-dim)]">{button.hint}</span>
              )}
            </span>
          </label>
        )
      })}
      <div className="flex items-center gap-2 px-2 pt-1">
        <span className="min-w-0 flex-1 text-[11px] text-[var(--wd-dim)]">
          Hidden buttons stay in the ⋮ menu.
        </span>
        <button
          onClick={() => void resetToolbarButtons()}
          disabled={hidden.length === 0}
          className="flex-none rounded-md border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-40"
          data-testid="toolbar-reset"
        >
          Show all
        </button>
      </div>
    </div>
  )
}
