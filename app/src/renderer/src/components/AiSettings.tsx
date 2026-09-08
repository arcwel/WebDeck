import { useEffect, useState } from 'react'
import type { AiProvider, SecretsStatus } from '@shared/ipc'
import { useShellStore } from '@/store'
import { LocalModels } from '@/components/LocalModels'

/**
 * AI providers.
 *
 * Where the API keys for the built-in agent live, and where more can be added.
 * The keys are held encrypted in the OS keychain by the main process (see
 * secrets.ts) — this panel only ever sends a key down and asks back which
 * providers are configured, so a saved key is never read back into the
 * renderer or shown again.
 *
 * There is no "sign in with your subscription": none of the three providers
 * permit a third-party app to use a consumer Claude/ChatGPT/Gemini plan through
 * their API, so a key is the only honest path. The model picker at the top
 * changes which Claude model the agent runs.
 */

interface ProviderMeta {
  id: AiProvider
  name: string
  hint: string
  keyPrefix: string
  keysUrl: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    hint: 'Powers the built-in agent. Keys start with sk-ant-.',
    keyPrefix: 'sk-ant-',
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    hint: 'For GPT-backed tools. Keys start with sk-.',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'gemini',
    name: 'Google (Gemini)',
    hint: 'For Gemini-backed tools.',
    keyPrefix: 'AI',
    keysUrl: 'https://aistudio.google.com/app/apikey'
  }
]

/** The Claude models the agent can run. Labels for the UI, ids for the API. */
const CLAUDE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' }
]

export function AiSettings(): React.JSX.Element {
  const [status, setStatus] = useState<SecretsStatus | null>(null)
  const [model, setModel] = useState<string>('')

  const refresh = (): void => {
    void window.agweb.secrets.list().then(setStatus)
    void window.agweb.agents.keyStatus().then((s) => setModel(s.model))
  }
  useEffect(refresh, [])

  return (
    <div className="flex flex-col gap-3 p-3 text-[12px]">
      {/* Model picker — change which model the agent runs. */}
      <section className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--wd-text)]">Model</span>
          <select
            value={model}
            onChange={(e) => {
              // Optimistic, then reverted if the save fails — otherwise the
              // dropdown shows a model that was never persisted.
              const previous = model
              const next = e.target.value
              setModel(next)
              // Through the registry, so choosing a cloud model also clears any
              // local choice that was standing in for the agent.
              void window.agweb.models
                .use('agent', `anthropic/${next}`)
                .catch(() => setModel(previous))
            }}
            className="ml-auto rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
            aria-label="Agent model"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {/* Show an unknown/env-pinned model rather than silently mismatching. */}
            {model && !CLAUDE_MODELS.some((m) => m.id === model) && (
              <option value={model}>{model}</option>
            )}
          </select>
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">
          The cloud choice, synced between your machines. OpenAI and Gemini keys below are stored
          for tools that use them. A model on this Mac can take over below.
        </p>
      </section>

      <LocalModels />

      {status && !status.encryptionAvailable && status.source.mode === 'stored' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          This system has no OS keychain available, so API keys can’t be stored securely and saving
          is disabled. Use a password manager below, or set the provider’s environment variable.
        </p>
      )}

      <KeySource status={status} onChange={refresh} />

      {PROVIDERS.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          configured={status?.configured[provider.id] ?? false}
          canSave={status?.encryptionAvailable ?? false}
          commandMode={status?.source.mode === 'command'}
          command={status?.source.commands[provider.id] ?? ''}
          onChange={refresh}
        />
      ))}

      <section className="mt-1 rounded-lg border border-dashed border-[var(--wd-glass-border)] px-3 py-2">
        <h3 className="text-[11px] font-semibold text-[var(--wd-text)]">
          Why an API key, not a login?
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">
          Anthropic, OpenAI, and Google don’t let a third-party app use your Claude, ChatGPT, or
          Gemini <em>subscription</em> through their API — programmatic access is by API key only. A
          key is billed to your own provider account and is stored encrypted in your OS keychain.
        </p>
      </section>
    </div>
  )
}

function ProviderRow({
  provider,
  configured,
  canSave,
  commandMode,
  command,
  onChange
}: {
  provider: ProviderMeta
  configured: boolean
  canSave: boolean
  commandMode: boolean
  command: string
  onChange: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Reset the draft when the saved command changes, without an effect — this is
  // React's "adjust state during render" pattern, and it avoids the cascading
  // render an effect-based reset would cause.
  const [draftCommand, setDraftCommand] = useState(command)
  const [savedCommand, setSavedCommand] = useState(command)
  if (command !== savedCommand) {
    setSavedCommand(command)
    setDraftCommand(command)
  }

  const saveCommand = async (): Promise<void> => {
    setBusy(true)
    await window.agweb.secrets.setSource({ commands: { [provider.id]: draftCommand } })
    setBusy(false)
    onChange()
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const ok = await window.agweb.secrets.set(provider.id, value)
    setBusy(false)
    if (!ok) {
      setError('Could not save the key. Is the OS keychain available?')
      return
    }
    setValue('')
    onChange()
  }

  const clear = async (): Promise<void> => {
    await window.agweb.secrets.clear(provider.id)
    onChange()
  }

  return (
    <section className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--wd-text)]">{provider.name}</span>
        {configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-emerald-500">
            Configured
          </span>
        )}
        {/* Log in to your provider account and create a key — the honest path
            to using your account's credits from a third-party app. */}
        <button
          onClick={() => {
            useShellStore.getState().setSettingsOpen(false)
            useShellStore.getState().newTab(provider.keysUrl)
          }}
          className="ml-auto text-[10.5px] font-medium text-[var(--wd-accent)] hover:underline"
        >
          Get a key →
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">{provider.hint}</p>

      {commandMode ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            value={draftCommand}
            onChange={(e) => setDraftCommand(e.target.value)}
            placeholder={`e.g. op read op://Private/${provider.id}/key`}
            className="min-w-0 flex-1 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 font-mono text-[11px] outline-none focus:border-[var(--wd-accent)]"
            autoComplete="off"
            spellCheck={false}
            data-testid={`secret-command-${provider.id}`}
          />
          <button
            onClick={() => void saveCommand()}
            disabled={busy || draftCommand === command}
            className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Use'}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={configured ? 'Replace saved key…' : `${provider.keyPrefix}…`}
            disabled={!canSave}
            className="min-w-0 flex-1 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)] disabled:opacity-40"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={() => void save()}
            disabled={!canSave || busy || value.trim() === ''}
            className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {configured && (
            <button
              onClick={() => void clear()}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--wd-dim)] hover:text-rose-500"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
    </section>
  )
}

/**
 * Where keys come from. This is a security choice, not a preference, so the
 * panel says plainly what each option means rather than leaving the user to
 * guess — and recommends the password manager, because it is genuinely better.
 */
function KeySource({
  status,
  onChange
}: {
  status: SecretsStatus | null
  onChange: () => void
}): React.JSX.Element {
  const mode = status?.source.mode ?? 'stored'

  const choose = async (next: 'stored' | 'command'): Promise<void> => {
    await window.agweb.secrets.setSource({ mode: next })
    onChange()
  }

  return (
    <section className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5" data-testid="key-source">
      <h3 className="text-[11px] font-semibold text-[var(--wd-text)]">Where keys come from</h3>
      <div className="mt-1.5 flex flex-col gap-1.5">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={mode === 'stored'}
            onChange={() => void choose('stored')}
            className="mt-0.5"
            data-testid="key-source-stored"
          />
          <span className="text-[11px]">
            <span className="font-medium text-[var(--wd-text)]">Store in WebDeck</span>
            <span className="text-[var(--wd-dim)]">
              {' '}
              — encrypted with your OS keychain. Simple, and the key sits on this machine.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={mode === 'command'}
            onChange={() => void choose('command')}
            className="mt-0.5"
            data-testid="key-source-command"
          />
          <span className="text-[11px]">
            <span className="font-medium text-[var(--wd-text)]">
              Use my password manager <span className="text-emerald-500">(recommended)</span>
            </span>
            <span className="text-[var(--wd-dim)]">
              {' '}
              — WebDeck stores nothing and runs a command you choose to fetch the key. Your vault
              keeps gating, auditing, and rotating it, and a leaked WebDeck data folder holds no key
              at all.
            </span>
          </span>
        </label>
      </div>
      {mode === 'command' && (
        <p className="mt-2 text-[10.5px] text-[var(--wd-dim)]">
          Enter one command per provider below. Examples:{' '}
          <code className="font-mono">op read op://Private/anthropic/key</code>,{' '}
          <code className="font-mono">pass show ai/anthropic</code>,{' '}
          <code className="font-mono">security find-generic-password -w -s anthropic</code>. The
          command runs without a shell, so <code className="font-mono">;</code> and{' '}
          <code className="font-mono">|</code> are literal. This setting is never synced between
          machines.
        </p>
      )}
    </section>
  )
}
