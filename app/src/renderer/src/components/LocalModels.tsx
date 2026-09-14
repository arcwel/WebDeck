import { useCallback, useEffect, useState } from 'react'
import type { ModelRole, ModelRuntimeStatus, ModelsListResult } from '@shared/models'
import { notifyModelsChanged } from '@/models-changed'
import { ModelRow } from './local-models/ModelRow'
import { PullModel } from './local-models/PullModel'
import { EndpointForm } from './local-models/EndpointForm'
import { isLocalId, modelsOf } from './local-models/format'

/**
 * Models on this machine.
 *
 * One card per runtime — Ollama, LM Studio, each endpoint the user typed, and
 * Apple's on-device model — each saying whether it is installed and answering,
 * with the one action that changes that: start it, or install it. Under each,
 * the models it holds with the capabilities the runtime reports rather than
 * ones we assume, because a model that cannot call tools cannot run the agent
 * and the button that would let it says so instead.
 *
 * Choosing here is per machine and never syncs; the cloud choice above is the
 * one that travels. "Back to Claude" clears the local choice for a role.
 */
export function LocalModels(): React.JSX.Element {
  const [list, setList] = useState<ModelsListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setList(await window.agweb.models.list())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    // Inline rather than through refresh(): the state writes happen after the
    // answer arrives, never in the effect's own tick.
    let live = true
    void window.agweb.models
      .list()
      .then((result) => {
        if (live) setList(result)
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      live = false
    }
  }, [])

  const act = async (work: () => Promise<ModelsListResult | void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await work()
      if (result) setList(result)
      else await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const use = (role: ModelRole, id: string | null): Promise<void> =>
    act(async () => {
      const result = await window.agweb.models.use(role, id)
      notifyModelsChanged()
      return result
    })

  const runtimes = list?.runtimes.filter((r) => r.provider !== 'anthropic') ?? []
  const pulled = new Set(
    (list?.models ?? []).filter((m) => m.provider === 'ollama').map((m) => m.model)
  )
  const onPulled = useCallback(() => void refresh(), [refresh])
  const onAdded = useCallback(() => void refresh(), [refresh])

  return (
    <section className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5" data-testid="local-models">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--wd-text)]">On this Mac</span>
        <button
          onClick={() => void refresh()}
          className="ml-auto text-[11px] text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
        >
          Refresh
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">
        A model that runs here needs no key and sends nothing off the machine. The choice is per
        machine and does not sync.
      </p>

      {runtimes.map((runtime) => {
        const models = modelsOf(runtime, list?.models ?? [])
        return (
          <div key={runtime.id}>
            <RuntimeCard
              status={runtime}
              busy={busy}
              onStart={() =>
                void act(() => window.agweb.models.start(runtime.id).then(() => undefined))
              }
              onRemove={
                runtime.custom
                  ? () =>
                      void act(() =>
                        window.agweb.models.removeEndpoint(runtime.id.replace(/^endpoint:/, ''))
                      )
                  : undefined
              }
            />
            {models.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {models.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    selection={list?.selection}
                    busy={busy}
                    onUse={(role) => void use(role, m.id)}
                    onRemove={
                      m.provider === 'ollama'
                        ? () => void act(() => window.agweb.models.remove(m.id))
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
            {runtime.id === 'ollama' && runtime.running && (
              <PullModel busy={busy} pulled={pulled} onPulled={onPulled} />
            )}
          </div>
        )
      })}

      <EndpointForm busy={busy} onAdded={onAdded} />

      {list && (isLocalId(list.selection.agent) || isLocalId(list.selection.ask)) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {isLocalId(list.selection.agent) && (
            <button
              onClick={() => void use('agent', null)}
              disabled={busy}
              className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-50"
            >
              Agent: back to Claude
            </button>
          )}
          {isLocalId(list.selection.ask) && (
            <button
              onClick={() => void use('ask', null)}
              disabled={busy}
              className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-50"
            >
              Ask: back to Claude
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          className="mt-2 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400"
          data-testid="local-models-error"
        >
          {error}
        </p>
      )}
    </section>
  )
}

function RuntimeCard({
  status,
  busy,
  onStart,
  onRemove
}: {
  status: ModelRuntimeStatus
  busy: boolean
  onStart: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const dot = status.running ? 'bg-emerald-500' : status.installed ? 'bg-amber-500' : 'bg-slate-400'
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--wd-glass-border)] px-2 py-1.5"
      data-testid={`runtime-${status.id}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-medium text-[var(--wd-text)]">{status.label}</span>
      <span
        className="min-w-0 flex-1 truncate text-[11px] text-[var(--wd-dim)]"
        title={
          status.endpoint
            ? `${status.endpoint}${status.detail ? ` — ${status.detail}` : ''}`
            : status.detail
        }
      >
        {status.running
          ? `running${status.version ? ` · ${status.version}` : ''} · ${status.detail ?? ''}`
          : status.detail}
      </span>
      {status.remote && (
        <span
          className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
          title="Not on this Mac: page text and workspace files are sent to it."
          data-testid="runtime-remote"
        >
          off this Mac
        </span>
      )}
      {!status.running && status.installed && status.startable && (
        <button
          onClick={onStart}
          disabled={busy}
          className="rounded bg-[var(--wd-accent)] px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          Start
        </button>
      )}
      {!status.installed && status.installUrl && (
        <a
          href={status.installUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] text-[var(--wd-text)]"
        >
          Install {status.label}
        </a>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={busy}
          className="rounded px-1.5 py-0.5 text-[11px] text-[var(--wd-dim)] hover:text-rose-500 disabled:opacity-40"
          data-testid="endpoint-remove"
        >
          Remove
        </button>
      )}
    </div>
  )
}
