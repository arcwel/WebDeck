import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentLogEntry, AgentSessionInfo, AgentStatus } from '@shared/agents'
import { monaco } from '@/monaco'
import { useMonacoReady } from '@/monaco-ready'
import { useShellStore, type ComposerSurface } from '@/store'
import { usePopover } from '@/popover'
import { onModelsChanged } from '@/models-changed'
import { CloseIcon } from '@/components/icons'
import { PermissionPopover, usePolicyStatus } from '@/components/PermissionPopover'
import { AnchoredPopover } from '@/components/AnchoredPopover'
import { POLICY_GUARDS } from '@shared/ipc'
import { Composer } from '@/components/Composer'
import { InlineTerminal } from '@/components/InlineTerminal'
import { ProseTurn, ToolCall } from './TranscriptTurn'
import { usePolicyPrompts } from '@/components/ActionPrompts'

/**
 * Mission Control (Phase 6): compose a task, review + approve the agent's
 * plan, then watch execution live. Sessions come from the main process and
 * are mirrored into every window via agentUpdate events.
 */

const STATUS_STYLES: Record<AgentStatus, string> = {
  planning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  awaiting_approval: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  running: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  rejected: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  stopped: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
  interrupted: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  planning: 'Planning',
  awaiting_approval: 'Awaiting approval',
  running: 'Running',
  done: 'Done',
  rejected: 'Rejected',
  error: 'Error',
  stopped: 'Stopped',
  interrupted: 'Interrupted'
}

const PROMPT_VERBS: Record<string, string> = {
  file_write: 'write',
  command: 'run',
  browser_navigate: 'open'
}

const PLAN_KIND_GLYPHS: Record<string, string> = {
  edit: '✎',
  command: '❯',
  inspect: '🔍',
  verify: '✓',
  other: '·'
}

export function AgentsBlock({
  surface = 'deck'
}: { surface?: ComposerSurface } = {}): React.JSX.Element {
  const agentSessions = useShellStore((s) => s.agentSessions)
  const [diffEntry, setDiffEntry] = useState<AgentLogEntry | null>(null)
  // The shield: the same permission popover the composer's pill opens, kept
  // in the header so it is reachable when the composer is scrolled away.
  const policy = usePolicyStatus()
  const [permOpen, setPermOpen] = useState(false)
  const permPanelRef = useRef<HTMLDivElement>(null)
  const permRef = usePopover(
    permOpen,
    useCallback(() => setPermOpen(false), []),
    permPanelRef
  )

  const sessions = useMemo(
    () => Object.values(agentSessions).sort((a, b) => b.createdAt - a.createdAt),
    [agentSessions]
  )
  const anyFinished = sessions.some((s) => TERMINAL_STATUSES.has(s.status))

  return (
    <div className="relative flex h-full flex-col text-xs">
      <KeyBanner />
      <div className="flex flex-none items-center gap-1 border-b border-slate-200 px-2.5 py-1 dark:border-slate-800">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Conversations
        </span>
        <span className="text-[10px] text-slate-400">{sessions.length}</span>
        <div className="ml-auto flex items-center gap-1">
          {policy && (
            <div className="relative" ref={permRef}>
              <button
                onClick={() => setPermOpen((o) => !o)}
                className={`rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800 ${
                  permOpen ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'
                }`}
                title="Agent permissions"
                aria-label="Agent permissions"
                aria-expanded={permOpen}
                data-testid="agent-permissions"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
                </svg>
              </button>
              {permOpen && (
                <AnchoredPopover
                  anchorRef={permRef}
                  panelRef={permPanelRef}
                  placement="below"
                  align="end"
                  width={300}
                  role="dialog"
                  aria-label="Agent permissions"
                >
                  <PermissionPopover policy={policy} />
                </AnchoredPopover>
              )}
            </div>
          )}
          <HistoryMenu sessions={sessions} />
          <button
            onClick={() => useShellStore.getState().loadDraft('', [])}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            title="Start a new conversation"
            aria-label="New conversation"
            data-testid="agent-new"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
      {anyFinished && (
        <div className="flex flex-none justify-end border-b border-slate-200 px-2.5 py-1 dark:border-slate-800">
          <button
            onClick={() => void window.agweb.agents.clearFinished()}
            className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            title="Remove finished sessions and their stored artifacts"
            data-testid="agent-clear-finished"
          >
            Clear finished
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="flex flex-col gap-2.5 p-4 text-slate-500">
            <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
              Give the agent a task
            </span>
            <span className="leading-relaxed">
              It plans first and waits for your approval before touching the workspace. Commands run
              in a terminal you can watch, right here in the conversation.
            </span>
            <span className="leading-relaxed">
              Attach files with the paperclip or <span className="font-mono">@mention</span> them,
              and <span className="font-mono">/</span> lists the shortcuts.
            </span>
          </div>
        )}
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} onShowDiff={setDiffEntry} />
        ))}
      </div>
      <Composer surface={surface} />
      {diffEntry && <EditDiffModal entry={diffEntry} onClose={() => setDiffEntry(null)} />}
    </div>
  )
}

/** API-key entry, shown until a key is configured (hidden for the mock provider). */
function KeyBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<{
    configured: boolean
    mock: boolean
    model: string
    provider?: string
    local?: boolean
  }>()
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const refresh = (): void => void window.agweb.agents.keyStatus().then(setStatus)
    refresh()
    return onModelsChanged(refresh)
  }, [])

  if (!status || status.configured || status.mock) return null

  const save = async (): Promise<void> => {
    if (!key.trim() || saving) return
    setSaving(true)
    const next = await window.agweb.agents.setKey(key)
    setStatus(next)
    setKey('')
    setSaving(false)
  }

  if (status.local) {
    return (
      <div className="flex flex-none items-center gap-2 border-b border-amber-300/50 bg-amber-50 px-2.5 py-2 dark:bg-amber-500/10">
        <span className="text-amber-700 dark:text-amber-400">
          {status.model} runs on this Mac, but Ollama is not answering. Start it under Settings →
          AI.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-none items-center gap-2 border-b border-amber-300/50 bg-amber-50 px-2.5 py-2 dark:bg-amber-500/10">
      <span className="text-amber-700 dark:text-amber-400">
        Anthropic API key required ({status.model}):
      </span>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
        placeholder="sk-ant-…"
        className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1 outline-none focus:border-amber-500 dark:border-amber-500/40 dark:bg-transparent"
      />
      <button
        onClick={() => void save()}
        disabled={!key.trim() || saving}
        className="rounded bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
      >
        Save
      </button>
    </div>
  )
}

const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set([
  'done',
  'error',
  'stopped',
  'rejected',
  'interrupted'
])

function SessionCard({
  session,
  onShowDiff
}: {
  session: AgentSessionInfo
  onShowDiff: (entry: AgentLogEntry) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  // The gate belongs where the decision is: this session's own transcript.
  const { promptFor, respond } = usePolicyPrompts()
  const loadDraft = useShellStore((s) => s.loadDraft)
  const prompt = promptFor(session.id)
  const [editingStep, setEditingStep] = useState<string | null>(null)
  const [stepText, setStepText] = useState('')
  const active = session.status === 'planning' || session.status === 'running'
  const finished = TERMINAL_STATUSES.has(session.status)
  const editable = session.status === 'awaiting_approval'

  // Derived, not an effect: a live agentUpdate can approve/advance the session
  // from another window, and the open editor must stop being an editor in the
  // same render — an Enter must never rewrite an already-running plan (P2-8).
  const activeEditingStep = editable ? editingStep : null

  // Plan editing (6.4): tweak the plan while it awaits approval.
  const savePlan = (steps: typeof session.plan): void => {
    void window.agweb.agents.updatePlan(session.id, steps)
    setEditingStep(null)
  }
  const saveStepTitle = (id: string): void => {
    const title = stepText.trim()
    if (!title) return setEditingStep(null)
    savePlan(session.plan.map((s) => (s.id === id ? { ...s, title } : s)))
  }

  return (
    <div
      className="border-b border-slate-200 dark:border-slate-800"
      data-testid={`agent-session-${session.id}`}
    >
      <div
        onClick={() => setExpanded((v) => !v)}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[session.status]}`}
          data-testid="agent-status"
        >
          {STATUS_LABELS[session.status]}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
          {session.task}
        </span>
        {active && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void window.agweb.agents.stop(session.id)
            }}
            className="flex-none rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Stop
          </button>
        )}
        {session.status === 'interrupted' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void window.agweb.agents.resume(session.id)
            }}
            className="flex-none rounded border border-amber-400/60 px-2 py-0.5 text-[10px] font-semibold text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10"
            title="Continue this session where the restart cut it off"
            data-testid="agent-resume"
          >
            Resume
          </button>
        )}
        {finished && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              loadDraft(session.task, session.attachments ?? [])
            }}
            className="flex-none rounded border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            title="Put this task and its context back in the composer to change and send again"
            data-testid="agent-resend"
          >
            Edit &amp; resend
          </button>
        )}
        {finished && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void window.agweb.agents.openReport(session.id)
            }}
            className="flex-none rounded border border-sky-400/60 px-2 py-0.5 text-[10px] font-semibold text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
            title="Open the execution report (plan, timeline, diffs, screenshots) in a browser tab"
            data-testid="agent-report"
          >
            Report
          </button>
        )}
        <SessionMenu session={session} />
        <button
          onClick={(e) => {
            e.stopPropagation()
            void window.agweb.agents.remove(session.id)
          }}
          className="flex-none rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800"
          aria-label={`Close ${session.task}`}
          title="Close this conversation"
          data-testid="agent-close"
        >
          <CloseIcon size={11} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5">
          {session.plan.length > 0 && (
            <div className="mb-2 rounded-md border border-slate-200 dark:border-slate-800">
              <div className="border-b border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase dark:border-slate-800">
                Plan
              </div>
              <ol className="px-2.5 py-1.5" data-testid="agent-plan">
                {session.plan.map((step, i) => (
                  <li
                    key={step.id}
                    className="group/step flex gap-2 py-0.5 text-slate-600 dark:text-slate-300"
                  >
                    <span className="flex-none text-slate-400">
                      {PLAN_KIND_GLYPHS[step.kind] ?? '·'}
                    </span>
                    {activeEditingStep === step.id ? (
                      <input
                        autoFocus
                        value={stepText}
                        onChange={(e) => setStepText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveStepTitle(step.id)}
                        onBlur={() => setEditingStep(null)}
                        className="min-w-0 flex-1 rounded border border-sky-500 bg-transparent px-1.5 py-0.5 outline-none"
                      />
                    ) : (
                      <span className="min-w-0">
                        {step.title}
                        {step.detail && <span className="text-slate-400"> — {step.detail}</span>}
                      </span>
                    )}
                    {editable && activeEditingStep !== step.id && (
                      <span className="ml-auto hidden shrink-0 gap-1 group-hover/step:flex">
                        <button
                          onClick={() => {
                            setEditingStep(step.id)
                            setStepText(step.title)
                          }}
                          className="rounded px-1 text-slate-400 hover:text-sky-500"
                          aria-label={`Edit step ${i + 1}`}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => savePlan(session.plan.filter((s) => s.id !== step.id))}
                          className="rounded px-1 text-slate-400 hover:text-red-500"
                          aria-label={`Remove step ${i + 1}`}
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </li>
                ))}
                {editable && (
                  <li className="py-0.5">
                    <button
                      onClick={() =>
                        savePlan([...session.plan, { id: '', kind: 'other', title: 'New step' }])
                      }
                      className="text-[11px] font-semibold text-slate-400 hover:text-sky-500"
                      aria-label="Add plan step"
                    >
                      + Add step
                    </button>
                  </li>
                )}
              </ol>
              {session.status === 'awaiting_approval' && (
                <div className="flex gap-2 border-t border-slate-200 px-2.5 py-2 dark:border-slate-800">
                  <button
                    onClick={() => void window.agweb.agents.approve(session.id)}
                    className="rounded-md bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-500"
                    data-testid="agent-approve"
                  >
                    Approve &amp; run
                  </button>
                  <button
                    onClick={() => void window.agweb.agents.reject(session.id)}
                    className="rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    data-testid="agent-reject"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
          <ActivityFeed
            entries={session.log}
            onShowDiff={onShowDiff}
            onBranch={(entry) =>
              loadDraft(
                `Continuing from "${session.task}".\n\nPicking up at:\n\n> ${entry.text
                  .split('\n')
                  .join('\n> ')}\n\n`,
                session.attachments ?? []
              )
            }
          />
          {prompt && (
            <div
              data-testid="policy-prompt"
              className="mt-2 flex items-center gap-2.5 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 dark:bg-amber-500/10"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#e0b04f"
                strokeWidth={2}
                strokeLinecap="round"
                className="flex-none"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.4h.01" />
              </svg>
              <span className="min-w-0 truncate text-[11.5px] text-amber-700 dark:text-amber-400">
                {prompt.guard && (
                  <span className="font-semibold">
                    {POLICY_GUARDS.find((g) => g.id === prompt.guard)?.label} guard:{' '}
                  </span>
                )}
                wants to {PROMPT_VERBS[prompt.kind]}{' '}
                <span className="font-mono">{prompt.detail}</span>
              </span>
              <span className="ml-auto flex flex-none gap-1.5">
                <button
                  onClick={() => respond(prompt.id, false)}
                  data-testid="policy-block"
                  className="rounded-md border border-slate-300 px-2.5 py-0.5 text-[10.5px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300"
                >
                  Deny
                </button>
                <button
                  onClick={() => respond(prompt.id, true)}
                  data-testid="policy-allow"
                  className="rounded-md bg-amber-500 px-2.5 py-0.5 text-[10.5px] font-semibold text-slate-900"
                >
                  Allow
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const LOG_COLORS: Record<AgentLogEntry['kind'], string> = {
  status: 'text-sky-600 dark:text-sky-400',
  text: 'text-slate-600 dark:text-slate-300',
  tool: 'text-slate-400',
  edit: 'text-emerald-600 dark:text-emerald-400',
  command: 'text-indigo-600 dark:text-indigo-400',
  browser: 'text-cyan-600 dark:text-cyan-400',
  screenshot: 'text-purple-600 dark:text-purple-400',
  error: 'text-red-500'
}

function ActivityFeed({
  entries,
  onShowDiff,
  onBranch
}: {
  entries: AgentLogEntry[]
  onShowDiff: (entry: AgentLogEntry) => void
  /** Start a new conversation from this turn, carrying it as quoted context. */
  onBranch: (entry: AgentLogEntry) => void
}): React.JSX.Element {
  // One inline terminal per pty: the final entry for a session wins, so a
  // finished command replaces its own running pane rather than stacking.
  const latestForTerminal = new Map<string, number>()
  entries.forEach((entry, i) => {
    if (entry.terminalId) latestForTerminal.set(entry.terminalId, i)
  })

  return (
    <div className="space-y-0.5 font-mono text-[11px]" data-testid="agent-log">
      {entries.map((entry, i) => {
        if (entry.terminalId) {
          if (latestForTerminal.get(entry.terminalId) !== i) return null
          return (
            <InlineTerminal
              key={entry.terminalId}
              terminalId={entry.terminalId}
              command={entry.text}
              exitCode={entry.exitCode}
            />
          )
        }
        return (
          <div key={i} className={`flex gap-2 ${LOG_COLORS[entry.kind]}`}>
            <span className="flex-none text-slate-400/60">
              {new Date(entry.ts).toLocaleTimeString()}
            </span>
            {entry.kind === 'text' ? (
              <div className="group min-w-0 flex-1">
                <ProseTurn text={entry.text} streaming={entry.streaming} />
                {!entry.streaming && (
                  <button
                    onClick={() => onBranch(entry)}
                    className="mt-0.5 text-[10px] font-semibold text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-slate-600 dark:hover:text-slate-300"
                    title="Start a new conversation from this turn"
                  >
                    Branch from here
                  </button>
                )}
              </div>
            ) : entry.kind === 'tool' ? (
              <ToolCall text={entry.text} />
            ) : (
              <span className="min-w-0 whitespace-pre-wrap break-words">
                {entry.text}
                {entry.kind === 'edit' && entry.path && (
                  <button
                    onClick={() => onShowDiff(entry)}
                    className="ml-2 rounded border border-emerald-400/50 px-1.5 text-[10px] font-semibold hover:bg-emerald-500/10"
                  >
                    View diff
                  </button>
                )}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Conversation history.
 *
 * Sessions persist across restarts, so after a few days of work the block
 * holds far more than fits on screen. This is the index: every conversation,
 * newest first, with its status and when it started — click one to scroll to
 * it. Searchable, because "the one where it fixed the parser" is how people
 * actually remember a conversation.
 */
function HistoryMenu({ sessions }: { sessions: AgentSessionInfo[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), []),
    panelRef
  )

  const matches = sessions.filter((session) =>
    session.task.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        title="Conversation history"
        aria-label="Conversation history"
        data-testid="agent-history"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 8v4l3 2" />
        </svg>
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={ref}
          panelRef={panelRef}
          placement="below"
          align="end"
          width={288}
          maxHeight={320}
          className="rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          data-testid="agent-history-menu"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="mx-2 mb-1 w-[calc(100%-16px)] rounded border border-slate-200 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-sky-500 dark:border-slate-700"
          />
          {matches.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-slate-400">
              {sessions.length === 0 ? 'No conversations yet.' : 'Nothing matches.'}
            </div>
          )}
          {matches.map((session) => (
            <button
              key={session.id}
              onClick={() => {
                setOpen(false)
                document
                  .querySelector(`[data-testid="agent-session-${session.id}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">
                {session.task}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className={`rounded px-1 ${STATUS_STYLES[session.status]}`}>
                  {STATUS_LABELS[session.status]}
                </span>
                {new Date(session.createdAt).toLocaleString()}
              </span>
            </button>
          ))}
        </AnchoredPopover>
      )}
    </div>
  )
}

/**
 * Per-conversation actions (task 11.9): rename, export, delete.
 *
 * These live behind a ⋯ rather than beside Stop/Report because they are
 * housekeeping, not part of watching a run — the header stays legible when a
 * dozen sessions are stacked.
 */
function SessionMenu({ session }: { session: AgentSessionInfo }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // Escape and outside-click dismissal, same as every other menu in the shell.
  const menuRef = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )
  const [renaming, setRenaming] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const act = (e: React.MouseEvent, run: () => void): void => {
    e.stopPropagation()
    setOpen(false)
    run()
  }

  const exportAs = async (format: 'md' | 'json'): Promise<void> => {
    const result = await window.agweb.agents.export(session.id, format)
    setNote(result.error ? result.error : `Saved ${result.path?.split('/').pop()}`)
    setTimeout(() => setNote(null), 2600)
  }

  return (
    <div ref={menuRef} className="relative flex-none" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded px-1.5 py-0.5 text-[13px] leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-label="Conversation options"
        data-testid="agent-menu"
      >
        ⋯
      </button>

      {renaming !== null && (
        <input
          autoFocus
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => setRenaming(null)}
          data-testid="agent-rename"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void window.agweb.agents.rename(session.id, renaming)
              setRenaming(null)
            }
            if (e.key === 'Escape') setRenaming(null)
          }}
          className="absolute right-0 top-6 z-20 w-56 rounded border border-sky-500 bg-white px-2 py-1 text-[11px] outline-none dark:bg-slate-900"
        />
      )}

      {note && (
        <div className="absolute right-0 top-6 z-20 whitespace-nowrap rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {note}
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-6 z-20 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[11px] shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <MenuItem onClick={(e) => act(e, () => setRenaming(session.task))}>Rename</MenuItem>
          <MenuItem onClick={(e) => act(e, () => void exportAs('md'))}>Export Markdown</MenuItem>
          <MenuItem onClick={(e) => act(e, () => void exportAs('json'))}>Export JSON</MenuItem>
          <MenuItem
            danger
            onClick={(e) =>
              act(e, () => {
                void window.agweb.agents.remove(session.id)
              })
            }
          >
            Delete
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
        danger ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

/** Monaco diff of one agent edit: file before (left) vs after (right). */
function EditDiffModal({
  entry,
  onClose
}: {
  entry: AgentLogEntry
  onClose: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const monacoReady = useMonacoReady()

  useEffect(() => {
    const container = containerRef.current
    if (!container || !monacoReady) return
    const diff = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      fontSize: 12
    })
    const original = monaco.editor.createModel(entry.before ?? '')
    const modified = monaco.editor.createModel(entry.after ?? '')
    diff.setModel({ original, modified })
    return () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [entry, monacoReady])

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-white dark:bg-[#0e1420]">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-slate-200 px-3 text-xs dark:border-slate-800">
        <span className="font-semibold">Agent edit</span>
        <span className="text-slate-500">before ⟷ after · {entry.path}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close diff"
        >
          <CloseIcon />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}

/** Logs block: the merged live activity feed across every agent session. */
export function LogsBlock(): React.JSX.Element {
  const agentSessions = useShellStore((s) => s.agentSessions)
  const scrollRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    const all: (AgentLogEntry & { sessionId: string; task: string })[] = []
    for (const session of Object.values(agentSessions)) {
      for (const entry of session.log) {
        all.push({ ...entry, sessionId: session.id, task: session.task })
      }
    }
    return all.sort((a, b) => a.ts - b.ts)
  }, [agentSessions])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="h-full p-3 font-mono text-xs text-slate-500">
        No agent activity yet. Logs stream here while agents plan and execute.
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto p-2.5 font-mono text-[11px]"
      data-testid="logs-feed"
    >
      {entries.map((entry, i) => (
        <div key={i} className={`flex gap-2 py-px ${LOG_COLORS[entry.kind]}`}>
          <span className="flex-none text-slate-400/60">
            {new Date(entry.ts).toLocaleTimeString()}
          </span>
          <span className="flex-none text-slate-400" title={entry.task}>
            [{entry.sessionId}]
          </span>
          <span className="min-w-0 whitespace-pre-wrap break-words">{entry.text}</span>
        </div>
      ))}
    </div>
  )
}
