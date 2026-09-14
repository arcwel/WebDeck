import { useEffect, useState } from 'react'
import type { ModelRecommendations, PullProgress } from '@shared/models'
import { formatSize } from './format'

/**
 * Pulling a model into Ollama: a name box, the models worth pulling on a
 * machine with this much memory, and the progress of the one in flight.
 *
 * Progress is the core's: it arrives as events, and a pull started before this
 * panel opened is picked up from the core's own status rather than lost.
 */
export function PullModel({
  busy,
  pulled,
  onPulled
}: {
  busy: boolean
  /** Model names already on the machine, so a chip can say so. */
  pulled: Set<string>
  onPulled: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [recommend, setRecommend] = useState<ModelRecommendations | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.agweb.models
      .recommend()
      .then((r) => {
        if (live) setRecommend(r)
      })
      .catch(() => undefined)
    void window.agweb.models
      .pullStatus()
      .then((p) => {
        if (live && p) setProgress(p)
      })
      .catch(() => undefined)
    const off = window.agweb.models.onPull((p) => {
      if (!live) return
      setProgress(p.done ? (p.error ? p : null) : p)
      if (p.done) {
        if (p.error) setError(p.error)
        else onPulled()
      }
    })
    return () => {
      live = false
      off()
    }
  }, [onPulled])

  const pull = async (model: string): Promise<void> => {
    setError(null)
    try {
      setProgress(await window.agweb.models.pull(model))
      setName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const inFlight = progress && !progress.done
  const percent =
    progress?.total && progress.completed !== undefined
      ? Math.round((progress.completed / progress.total) * 100)
      : null

  return (
    <div className="mt-2 flex flex-col gap-1.5" data-testid="pull-model">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void pull(name.trim())
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Pull a model… e.g. qwen3.5:9b"
          disabled={busy || Boolean(inFlight)}
          className="min-w-0 flex-1 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
          aria-label="Model to pull"
          data-testid="pull-name"
        />
        <button
          type="submit"
          disabled={busy || Boolean(inFlight) || !name.trim()}
          className="rounded bg-[var(--wd-accent)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          data-testid="pull-start"
        >
          Pull
        </button>
      </form>

      {recommend && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--wd-dim)]">
            For this Mac ({Math.round(recommend.memoryBytes / 1_073_741_824)} GB):
          </span>
          <div className="flex flex-wrap gap-1">
            {recommend.models
              .filter((m) => m.fit !== 'no')
              .map((m) => {
                const have = pulled.has(m.model)
                return (
                  <button
                    key={m.model}
                    type="button"
                    disabled={busy || Boolean(inFlight) || have}
                    onClick={() => void pull(m.model)}
                    title={`${m.note} Needs about ${formatSize(m.needsBytes)} while running.`}
                    className={`rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-60 ${
                      m.recommended
                        ? 'border-[var(--wd-accent)] text-[var(--wd-accent)]'
                        : 'border-[var(--wd-glass-border)] text-[var(--wd-dim)] hover:text-[var(--wd-text)]'
                    }`}
                    data-testid={`recommend-${m.model}`}
                  >
                    {m.model} · {formatSize(m.sizeBytes)}
                    {have ? ' · pulled' : m.fit === 'tight' ? ' · tight' : ''}
                    {m.recommended && !have ? ' · recommended' : ''}
                  </button>
                )
              })}
          </div>
        </div>
      )}

      {progress && (
        <div
          className="rounded-md border border-[var(--wd-glass-border)] px-2 py-1.5"
          data-testid="pull-progress"
        >
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-[var(--wd-text)]">{progress.model}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--wd-dim)]">
              {progress.error
                ? progress.error
                : `${progress.status}${percent !== null ? ` · ${percent}%` : ''}${
                    progress.total ? ` of ${formatSize(progress.total)}` : ''
                  }`}
            </span>
            {inFlight && (
              <button
                onClick={() => void window.agweb.models.cancelPull()}
                className="rounded border border-[var(--wd-glass-border)] px-1.5 py-0.5 text-[10px] text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
                data-testid="pull-cancel"
              >
                Cancel
              </button>
            )}
            {progress.error && (
              <button
                onClick={() => {
                  setProgress(null)
                  setError(null)
                }}
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--wd-dim)]"
              >
                Dismiss
              </button>
            )}
          </div>
          {inFlight && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--wd-glass-border)]">
              <div
                className="h-full bg-[var(--wd-accent)] transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && !progress?.error && (
        <p className="rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}
