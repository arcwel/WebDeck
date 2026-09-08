import { useCallback, useEffect, useState } from 'react'
import type { ModelInfo, ModelRole, ModelRuntimeStatus, ModelsListResult } from '@shared/models'
import { notifyModelsChanged } from '@/models-changed'

/**
 * Models on this machine.
 *
 * Detection first: the card says whether Ollama is installed and answering,
 * and offers the one action that changes that — start it, or install it. Then
 * the models it holds, with the capabilities the runtime reports rather than
 * ones we assume, because a model that cannot call tools cannot run the agent
 * and the button that would let it says so instead.
 *
 * Choosing here is per machine and never syncs; the cloud choice above is the
 * one that travels. "Back to Claude" clears the local choice for a role.
 */
const INSTALL_URL = 'https://ollama.com/download'

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  const gb = bytes / 1_000_000_000
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

function formatContext(tokens?: number): string {
  if (!tokens) return ''
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k ctx` : `${tokens} ctx`
}

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

  const ollama = list?.runtimes.find((r) => r.provider === 'ollama')
  const local = list?.models.filter((m) => m.local) ?? []

  const use = async (role: ModelRole, id: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setList(await window.agweb.models.use(role, id))
      notifyModelsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.agweb.models.start('ollama')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

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

      {ollama && <RuntimeCard status={ollama} busy={busy} onStart={() => void start()} />}

      {local.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {local.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              selection={list?.selection}
              busy={busy}
              onUse={(role) => void use(role, m.id)}
            />
          ))}
        </ul>
      )}

      {(list?.selection.agent.startsWith('ollama/') ||
        list?.selection.ask.startsWith('ollama/')) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {list.selection.agent.startsWith('ollama/') && (
            <button
              onClick={() => void use('agent', null)}
              disabled={busy}
              className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-50"
            >
              Agent: back to Claude
            </button>
          )}
          {list.selection.ask.startsWith('ollama/') && (
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
        <p className="mt-2 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </section>
  )
}

function RuntimeCard({
  status,
  busy,
  onStart
}: {
  status: ModelRuntimeStatus
  busy: boolean
  onStart: () => void
}): React.JSX.Element {
  const dot = status.running ? 'bg-emerald-500' : status.installed ? 'bg-amber-500' : 'bg-slate-400'
  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-md border border-[var(--wd-glass-border)] px-2 py-1.5"
      data-testid="runtime-ollama"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-medium text-[var(--wd-text)]">Ollama</span>
      <span
        className="min-w-0 flex-1 truncate text-[11px] text-[var(--wd-dim)]"
        title={status.detail}
      >
        {status.running
          ? `running${status.version ? ` · ${status.version}` : ''} · ${status.detail ?? ''}`
          : status.detail}
      </span>
      {!status.running && status.installed && (
        <button
          onClick={onStart}
          disabled={busy}
          className="rounded bg-[var(--wd-accent)] px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          Start
        </button>
      )}
      {!status.installed && (
        <a
          href={INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] text-[var(--wd-text)]"
        >
          Install Ollama
        </a>
      )}
    </div>
  )
}

function ModelRow({
  model,
  selection,
  busy,
  onUse
}: {
  model: ModelInfo
  selection?: { agent: string; ask: string }
  busy: boolean
  onUse: (role: ModelRole) => void
}): React.JSX.Element {
  const isAgent = selection?.agent === model.id
  const isAsk = selection?.ask === model.id
  const badge = (on: boolean, label: string): React.JSX.Element => (
    <span
      className={`rounded px-1 text-[10px] ${
        on
          ? 'bg-[var(--wd-accent-soft)] text-[var(--wd-accent)]'
          : 'text-[var(--wd-dim)] line-through opacity-60'
      }`}
    >
      {label}
    </span>
  )
  const choice = (role: ModelRole, active: boolean, label: string): React.JSX.Element => (
    <button
      onClick={() => onUse(role)}
      disabled={busy || active || (role === 'agent' && !model.capabilities.tools)}
      title={
        role === 'agent' && !model.capabilities.tools
          ? 'This model cannot call tools, so it cannot run the agent.'
          : undefined
      }
      className={`rounded px-2 py-0.5 text-[11px] ${
        active
          ? 'bg-[var(--wd-accent)] font-semibold text-white'
          : 'border border-[var(--wd-glass-border)] text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-40'
      }`}
    >
      {active ? `${label} ✓` : label}
    </button>
  )
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1 hover:bg-[var(--wd-hover)]">
      <span className="font-medium text-[var(--wd-text)]">{model.model}</span>
      <span className="text-[10px] text-[var(--wd-dim)]">
        {[formatSize(model.sizeBytes), formatContext(model.contextLength)]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {badge(model.capabilities.tools, 'tools')}
      {badge(model.capabilities.thinking, 'thinking')}
      {badge(model.capabilities.vision, 'vision')}
      <span className="ml-auto flex gap-1">
        {choice('agent', isAgent, 'Agent')}
        {choice('ask', isAsk, 'Ask')}
      </span>
    </li>
  )
}
