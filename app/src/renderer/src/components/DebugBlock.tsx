import { useEffect, useState } from 'react'
import {
  control,
  evaluate,
  launch,
  onDebugEvent,
  scopeVariables,
  stackTrace,
  type StackFrame,
  type Variable
} from '@/debug'
import { useShellStore } from '@/store'
import { DEBUG_LANGUAGE_LABELS, debugLanguageOf } from '@shared/debug-languages'

/**
 * Debugging (task 12.4).
 *
 * Launch the active file under js-debug, stop at breakpoints set in the editor
 * gutter, and inspect where you landed: call stack, locals, and watch
 * expressions. Step controls drive the same adapter VS Code uses, so source
 * maps and TypeScript work without anything extra from us.
 */

export function DebugBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const activePath = useShellStore((s) => s.activeEditorPath)
  const breakpoints = useShellStore((s) => s.breakpoints)
  const openFile = useShellStore((s) => s.openFile)

  const [available, setAvailable] = useState<boolean | null>(null)
  const [running, setRunning] = useState(false)
  // js-debug stops in a child session, so the UI follows whichever session
  // reported the stop rather than assuming the root one.
  const [stopped, setStopped] = useState<{ sessionId: string; threadId: number } | null>(null)
  const [frames, setFrames] = useState<StackFrame[]>([])
  const [activeFrame, setActiveFrame] = useState<number | null>(null)
  const [variables, setVariables] = useState<Variable[]>([])
  const [output, setOutput] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [watches, setWatches] = useState<Array<{ expression: string; value: string }>>([])
  const [watchInput, setWatchInput] = useState('')

  // The adapter is the active file's: a .go file wants Delve, a .rs file lldb.
  const language = debugLanguageOf(activePath)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.agweb.debug.resolve(language ?? 'node').then((r) => {
      if (!live) return
      setAvailable(!('error' in r))
      setUnavailable('error' in r ? r.error : null)
    })
    return () => {
      live = false
    }
  }, [language])

  useEffect(
    () =>
      onDebugEvent((event, body, sessionId) => {
        if (event === 'stopped') {
          const id = (body as { threadId?: number }).threadId ?? 1
          setStopped({ sessionId, threadId: id })
          void stackTrace(sessionId, id).then((next) => {
            setFrames(next)
            setActiveFrame(next[0]?.id ?? null)
            // Jump the editor to where execution stopped — the reason anyone
            // sets a breakpoint is to look at that line.
            const top = next[0]
            if (top?.source?.path) openFile(relativize(top.source.path, workspace?.path), top.line)
          })
        }
        if (event === 'output') {
          const text = (body as { output?: string }).output
          if (text) setOutput((prev) => [...prev.slice(-200), text.replace(/\n$/, '')])
        }
        if (event === 'terminated' || event === 'exited') {
          setRunning(false)
          setStopped(null)
          setFrames([])
          setVariables([])
        }
      }),
    [openFile, workspace?.path]
  )

  // Locals follow the selected frame.
  useEffect(() => {
    if (activeFrame === null || !stopped) return
    let live = true
    void scopeVariables(stopped.sessionId, activeFrame).then((next) => {
      if (live) setVariables(next)
    })
    return () => {
      live = false
    }
  }, [activeFrame, stopped])

  // Watches re-evaluate wherever execution is now.
  useEffect(() => {
    if (activeFrame === null || watches.length === 0) return
    let live = true
    void Promise.all(
      watches.map(async (watch) => ({
        expression: watch.expression,
        value: await evaluate(stopped?.sessionId ?? 'root', watch.expression, activeFrame)
      }))
    ).then((next) => {
      if (live) setWatches(next)
    })
    return () => {
      live = false
    }
    // Only on a new stop: including `watches` would loop on its own update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrame])

  const start = async (): Promise<void> => {
    if (!activePath || !workspace) return
    setError(null)
    setOutput([])
    setRunning(true)
    // Absolute paths: the adapter is a separate process and does not share our
    // notion of a workspace-relative path.
    const absolute = (p: string): string => (p.startsWith('/') ? p : `${workspace.path}/${p}`)
    const result = await launch(
      absolute(activePath),
      workspace.path,
      Object.fromEntries(
        Object.entries(breakpoints)
          .filter(([, lines]) => lines.length)
          .map(([path, lines]) => [absolute(path), lines])
      ),
      language ?? 'node'
    )
    if (result.error) {
      setError(result.error)
      setRunning(false)
    }
  }

  if (available === false) {
    return (
      <div
        className="flex flex-col gap-2 p-4 text-xs text-slate-500"
        data-testid="debug-unavailable"
      >
        <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
          {language
            ? `No ${DEBUG_LANGUAGE_LABELS[language]} debugger on this machine`
            : 'Debug adapter not installed'}
        </span>
        <span className="leading-relaxed">
          {unavailable ??
            'js-debug is fetched at install time. Run node scripts/fetch-js-debug.mjs in app/ and reopen this block.'}
        </span>
      </div>
    )
  }

  const totalBreakpoints = Object.values(breakpoints).reduce((n, lines) => n + lines.length, 0)

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex flex-none items-center gap-1.5 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        {!running ? (
          <button
            onClick={() => void start()}
            disabled={!activePath || !language}
            className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
            title={
              !activePath
                ? 'Open a file to debug'
                : language
                  ? `Debug ${activePath} (${DEBUG_LANGUAGE_LABELS[language]})`
                  : 'No debugger for this kind of file'
            }
            data-testid="debug-start"
          >
            Debug file
          </button>
        ) : (
          <>
            <Step
              label="▶"
              title="Continue"
              onClick={() => stopped && control.continue(stopped.sessionId, stopped.threadId)}
            />
            <Step
              label="⤼"
              title="Step over"
              onClick={() => stopped && control.next(stopped.sessionId, stopped.threadId)}
            />
            <Step
              label="↓"
              title="Step into"
              onClick={() => stopped && control.stepIn(stopped.sessionId, stopped.threadId)}
            />
            <Step
              label="↑"
              title="Step out"
              onClick={() => stopped && control.stepOut(stopped.sessionId, stopped.threadId)}
            />
            <button
              onClick={() => void control.stop()}
              className="rounded border border-rose-400/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 hover:bg-rose-500/10"
              title="Stop"
              data-testid="debug-stop"
            >
              Stop
            </button>
          </>
        )}
        <span className="ml-auto truncate text-[10px] text-slate-400">
          {totalBreakpoints} {totalBreakpoints === 1 ? 'breakpoint' : 'breakpoints'}
          {activePath ? ` · ${activePath.split('/').pop()}` : ''}
        </span>
      </div>

      {error && <div className="flex-none px-2.5 py-1 text-[10px] text-rose-500">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!running && frames.length === 0 && (
          <div className="flex flex-col gap-2 p-4 text-slate-500">
            <span className="leading-relaxed">
              Click the editor gutter to set a breakpoint, then Debug file.
            </span>
            <span className="leading-relaxed">
              {language === 'node' || !language
                ? 'Runs under js-debug — the adapter VS Code uses — so TypeScript and source maps work.'
                : `Runs under the ${DEBUG_LANGUAGE_LABELS[language]} adapter found on this machine.`}
            </span>
          </div>
        )}

        <Section title="Call stack" show={frames.length > 0}>
          {frames.map((frame) => (
            <button
              key={frame.id}
              onClick={() => {
                setActiveFrame(frame.id)
                if (frame.source?.path) {
                  openFile(relativize(frame.source.path, workspace?.path), frame.line)
                }
              }}
              className={`flex w-full items-baseline gap-2 px-2.5 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${
                frame.id === activeFrame ? 'bg-sky-500/10' : ''
              }`}
              data-testid="debug-frame"
            >
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                {frame.name}
              </span>
              <span className="flex-none font-mono text-[10px] text-slate-400">
                {basename(frame.source?.name ?? frame.source?.path ?? '')}:{frame.line}
              </span>
            </button>
          ))}
        </Section>

        <Section title="Variables" show={variables.length > 0}>
          {variables.map((variable) => (
            <div key={variable.name} className="flex items-baseline gap-2 px-2.5 py-0.5">
              <span className="flex-none font-mono text-[11px] text-sky-600 dark:text-sky-400">
                {variable.name}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
                {variable.value}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Watch" show>
          {watches.map((watch, i) => (
            <div key={i} className="group flex items-baseline gap-2 px-2.5 py-0.5">
              <span className="flex-none font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {watch.expression}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
                {watch.value}
              </span>
              <button
                onClick={() => setWatches((prev) => prev.filter((_, n) => n !== i))}
                className="flex-none px-1 text-[10px] text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100"
                aria-label={`Remove watch ${watch.expression}`}
              >
                ×
              </button>
            </div>
          ))}
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !watchInput.trim()) return
              const expression = watchInput.trim()
              setWatchInput('')
              void evaluate(
                stopped?.sessionId ?? 'root',
                expression,
                activeFrame ?? undefined
              ).then((value) => setWatches((prev) => [...prev, { expression, value }]))
            }}
            placeholder="Add expression…"
            className="mx-2.5 my-1 w-[calc(100%-20px)] rounded border border-slate-200 bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-sky-500 dark:border-slate-700"
          />
        </Section>

        <Section title="Output" show={output.length > 0}>
          <pre className="whitespace-pre-wrap break-words px-2.5 py-1 font-mono text-[10px] text-slate-500">
            {output.join('\n')}
          </pre>
        </Section>
      </div>
    </div>
  )
}

/** Frames from Node internals carry full paths; only the file name is useful. */
function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** The adapter reports absolute paths; the editor opens workspace-relative. */
function relativize(path: string, root?: string): string {
  return root && path.startsWith(root) ? path.slice(root.length).replace(/^\//, '') : path
}

function Step({
  label,
  title,
  onClick
}: {
  label: string
  title: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    >
      {label}
    </button>
  )
}

function Section({
  title,
  show,
  children
}: {
  title: string
  show: boolean
  children: React.ReactNode
}): React.JSX.Element | null {
  if (!show) return null
  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {title}
      </div>
      {children}
    </div>
  )
}
