import { useState } from 'react'
import type { ModelInfo, ModelRole, ModelTestResult } from '@shared/models'
import { formatContext, formatSize } from './format'

/**
 * One model under its runtime card: what it can do as the runtime reports it,
 * the two choices (Agent, Ask), a Test that puts a number in front of the user
 * before they commit, and for Ollama a Remove.
 */
export function ModelRow({
  model,
  selection,
  busy,
  onUse,
  onRemove
}: {
  model: ModelInfo
  selection?: { agent: string; ask: string }
  busy: boolean
  onUse: (role: ModelRole) => void
  onRemove?: () => void
}): React.JSX.Element {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ModelTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const isAgent = selection?.agent === model.id
  const isAsk = selection?.ask === model.id

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestError(null)
    setResult(null)
    try {
      setResult(await window.agweb.models.test(model.id))
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

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
  const name = model.provider === 'openai-compatible' ? model.label : model.model
  return (
    <li
      className="flex flex-col gap-1 rounded-md px-2 py-1 hover:bg-[var(--wd-hover)]"
      data-testid={`model-${model.id}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-[var(--wd-text)]">{name}</span>
        <span className="text-[10px] text-[var(--wd-dim)]">
          {[formatSize(model.sizeBytes), formatContext(model.contextLength)]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {badge(model.capabilities.tools, 'tools')}
        {badge(model.capabilities.thinking, 'thinking')}
        {badge(model.capabilities.vision, 'vision')}
        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={() => void test()}
            disabled={busy || testing}
            className="rounded border border-[var(--wd-glass-border)] px-2 py-0.5 text-[11px] text-[var(--wd-dim)] hover:text-[var(--wd-text)] disabled:opacity-40"
            data-testid="model-test"
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
          {choice('agent', isAgent, 'Agent')}
          {choice('ask', isAsk, 'Ask')}
          {onRemove &&
            (confirmRemove ? (
              <>
                <button
                  onClick={() => {
                    setConfirmRemove(false)
                    onRemove()
                  }}
                  disabled={busy}
                  className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  data-testid="model-remove-confirm"
                >
                  Remove {formatSize(model.sizeBytes)}
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-[var(--wd-dim)]"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
                title="Remove this model from the machine"
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--wd-dim)] hover:text-rose-500 disabled:opacity-40"
                data-testid="model-remove"
              >
                Remove
              </button>
            ))}
        </span>
      </div>
      {result && (
        <p className="text-[11px] text-[var(--wd-dim)]" data-testid="model-test-result">
          <span className="font-medium text-[var(--wd-text)]">
            {result.firstTokenMs < 1000
              ? `${result.firstTokenMs} ms`
              : `${(result.firstTokenMs / 1000).toFixed(1)} s`}{' '}
            to first token
          </span>
          {result.tokensPerSecond > 0 && ` · ≈${result.tokensPerSecond} tokens/s`}
          {result.sample && ` · “${result.sample}”`}
        </p>
      )}
      {testError && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400" data-testid="model-test-error">
          {testError}
        </p>
      )}
    </li>
  )
}
