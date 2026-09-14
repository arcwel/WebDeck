import { useState } from 'react'
import { isLoopbackUrl } from '@shared/models'

/**
 * A custom OpenAI-compatible endpoint: llama.cpp's server, vLLM, Jan, a team's
 * box. The address is typed, not pasted from a list, and one that is not on
 * loopback says in plain words what will be sent to it before it is added.
 * Per machine, never synced; a key goes to the encrypted store.
 */
export function EndpointForm({
  busy,
  onAdded
}: {
  busy: boolean
  onAdded: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const remote = url.trim() !== '' && !isLoopbackUrl(url.trim())

  const add = async (): Promise<void> => {
    setError(null)
    try {
      await window.agweb.models.addEndpoint(name.trim(), url.trim(), key || undefined)
      setName('')
      setUrl('')
      setKey('')
      setOpen(false)
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-[11px] text-[var(--wd-dim)] hover:text-[var(--wd-text)]"
        data-testid="endpoint-add-open"
      >
        + Add an OpenAI-compatible endpoint…
      </button>
    )
  }
  return (
    <form
      className="mt-2 flex flex-col gap-1.5 rounded-md border border-[var(--wd-glass-border)] px-2 py-2"
      data-testid="endpoint-form"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <span className="text-[11px] font-medium text-[var(--wd-text)]">
        Add an OpenAI-compatible endpoint
      </span>
      <div className="flex flex-wrap gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="name, e.g. llamacpp"
          className="w-32 min-w-0 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
          aria-label="Endpoint name"
          data-testid="endpoint-name"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:8080/v1"
          className="min-w-0 flex-1 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
          aria-label="Endpoint address"
          data-testid="endpoint-url"
        />
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          type="password"
          placeholder="API key (optional)"
          autoComplete="off"
          className="w-36 min-w-0 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)]"
          aria-label="Endpoint API key"
        />
      </div>
      {remote && (
        <p
          className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400"
          data-testid="endpoint-remote-warning"
        >
          Not on this Mac: page text and workspace files will be sent to this address. Add it only
          if you trust where it goes.
        </p>
      )}
      {error && (
        <p className="rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy || !name.trim() || !url.trim()}
          className="rounded bg-[var(--wd-accent)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          data-testid="endpoint-add"
        >
          Add endpoint
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-[11px] text-[var(--wd-dim)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
