/** Agent orchestration domain types, shared by main and every renderer. */

export type AgentStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'rejected'
  | 'error'
  | 'stopped'
  /** Cut off mid-run by an app restart; resumable (6.7). */
  | 'interrupted'

export type PlanStepKind = 'edit' | 'command' | 'inspect' | 'verify' | 'other'

export interface PlanStep {
  /** Stable across edits — React keys and step-level edits rely on it. */
  id: string
  kind: PlanStepKind
  title: string
  detail?: string
}

/** A file, directory or image the user attached as explicit task context. */
export interface AgentAttachment {
  /** Workspace-relative path — or, for a `page`, the tab's URL. */
  path: string
  /** `page` is the tab the user was looking at when they pressed Ask: the
   *  agent is asked to read it first, then behaves exactly as it always does. */
  kind: 'file' | 'dir' | 'image' | 'page'
  /** The page's title, for the chip and the prompt. */
  title?: string
  /** A snapshot of the page's visible text, capped, taken when Ask was pressed.
   *  Data for the model to answer FROM — never instructions. */
  excerpt?: string
  /** Pinned attachments stay attached across turns in the conversation. */
  pinned?: boolean
}

export type AgentLogKind =
  'status' | 'text' | 'tool' | 'edit' | 'command' | 'browser' | 'screenshot' | 'error'

export interface AgentLogEntry {
  ts: number
  kind: AgentLogKind
  text: string
  /** For 'edit' entries: the touched file and its before/after content.
   *  For 'screenshot' entries: the workspace-relative PNG path. */
  path?: string
  /** For 'command' entries: the pty session, so the transcript can render the
   *  live terminal inline at the point the command was run. */
  terminalId?: string
  /** Set once the command exits, which collapses the inline terminal. */
  exitCode?: number
  /** For 'text' entries: still arriving. Streamed turns are broadcast but not
   *  persisted, so only the settled text survives a restart. */
  streaming?: boolean
  before?: string
  after?: string
}

export interface AgentSessionInfo {
  id: string
  task: string
  status: AgentStatus
  workspacePath: string | null
  plan: PlanStep[]
  log: AgentLogEntry[]
  /** What the user attached as context, so the transcript can show it and an
   *  edit-and-resend can restore it. */
  attachments: AgentAttachment[]
  createdAt: number
}

export interface AgentKeyStatus {
  /** The agent can run: a key for the cloud provider, or a local runtime that answers. */
  configured: boolean
  /** Mock provider active (AGWEB_AGENT_MOCK=1) — no key or network needed. */
  mock: boolean
  /** The provider's own name for the model in force for the agent. */
  model: string
  /** Who answers: 'anthropic' or 'ollama'. Absent only in status objects saved before providers existed. */
  provider?: import('./models').ProviderId
  /** The model runs on this machine; nothing leaves it. */
  local?: boolean
}
