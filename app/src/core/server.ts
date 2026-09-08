import {
  generateCoreToken,
  serveCoreOverWebSocket,
  type WsServerHandle
} from './transports/ws-server'
import { core } from './rpc'
import { setCoreEnv } from './env'
import { setCoreBroadcaster } from './notify'
import { nodeCoreEnv } from './node-env'

import { IpcChannels, IpcEvents } from '@shared/ipc'
import type { AppInfo } from '@shared/ipc'
import { registerSecretsRpc } from './domains/secrets'
import { registerVsxRpc } from './domains/vsx'
import {
  abortPendingEditorCommands,
  respondEditorCommand,
  setEditorCommandSink
} from './domains/editor-bridge'
import type { EditorCommandResponse } from '../shared/ipc'
import { registerAppSettingsRpc } from './domains/app-settings'
import { registerFileGrantsRpc, restoreOpenedFiles } from './domains/file-grants'
import { registerHistoryImportRpc } from './domains/history-import'
import { registerModelsRpc } from './domains/models/registry'
import {
  abortPendingPrompts,
  audit,
  decide,
  registerPolicyRpc,
  setPolicyBroadcaster,
  setPolicyDenyNotifier,
  setPolicyPromptSink
} from './domains/policy'
import type { PolicyActionKind } from '../shared/ipc'
import { registerGitRpc } from './domains/git'
import { registerRestRpc } from './domains/rest'
import { registerDbRpc } from './domains/db'
import { registerJupyterRpc } from './domains/jupyter'
import { setAgentBrowserPort } from './agent-browser-port'
import { chromiumAgentBrowser } from './chromium-agent-browser'
import { pageAgentBrowser } from './page-agent-browser'
import { registerTasksRpc } from './domains/tasks'
import { registerSearchRpc } from './domains/search'
import { registerFsRpc } from './domains/fs'
import { registerWorkspaceRpc } from './domains/workspace'
import { registerSettingsRpc } from './domains/settings'
import { registerSyncRpc } from './domains/sync'
import { registerLspRpc } from './domains/lsp'
import { registerDebugRpc } from './domains/debug'
import { registerTerminalRpc } from './domains/terminal'
import { registerAgentRpc } from './domains/agent'
import { registerSlidesRpc } from './domains/slides'
import { registerDevServersRpc } from './domains/dev-servers'
import { watchWorkspace } from './domains/fs'
import { setWorkspaceOpenedHook } from './domains/workspace'
import { setSyncBroadcaster, setSyncPulledNotifier } from './domains/sync'

/**
 * `webdeck-core` as a standalone process — the app running on the fork.
 *
 * Under the Chromium fork there is no Electron: the browser reaches the IDE/agent
 * logic over a localhost WebSocket. This boots that service — the same
 * `CoreRegistry`, the same domain handlers that run under Electron IPC today,
 * with host facts from Node (`nodeCoreEnv`) and events pushed to connected WS
 * clients instead of `BrowserWindow.webContents.send`. Nothing in the domains
 * changes; only the transport and the host adapter do. That is the whole point
 * of the decoupling — proven here by a running server with zero Electron.
 *
 * Every CORE domain runs here, the agent included: it reaches browser tabs
 * through the injected `AgentBrowserPort`. Under Electron that is an in-process
 * WebContentsView; here it is a Chromium instance of the agent's own, driven
 * over CDP (see chromium-agent-browser.ts for why it is not the user's).
 */
export interface CoreServerOptions {
  userDataDir?: string
  /**
   * The browser the agent drives. Omit to resolve the fork next to us or
   * $WEBDECK_BROWSER; pass `null` to run with no agent browser at all, which
   * makes the browser tools fail loudly instead of silently doing nothing.
   */
  agentBrowserPath?: string | null
  /**
   * Which browser the agent drives. 'session' is the user's own tabs, reached
   * through the WebDeck page — it only works under the fork, where that page
   * holds the Mojo interface. Defaults to 'isolated', which works anywhere.
   */
  agentBrowserMode?: 'session' | 'isolated'
  appDir?: string
  /** 0 (default) asks the OS for a free port. */
  port?: number
  host?: string
  /**
   * Write the chosen port and connection token here as `{ "port": N, "token": S }`,
   * mode 0600, for the WebUI host to discover. See ws-server.ts.
   */
  portFile?: string
  /**
   * The secret clients must present. Generated per boot when omitted — supply
   * one only when the spawner already knows it (tests do). There is no way to
   * ask for no token at all; the socket is never open to the whole machine.
   */
  authToken?: string
}

export async function startWebdeckCore(opts: CoreServerOptions = {}): Promise<WsServerHandle> {
  setCoreEnv(nodeCoreEnv({ userDataDir: opts.userDataDir, appDir: opts.appDir }))

  registerSecretsRpc()
  registerVsxRpc()
  registerAppSettingsRpc()
  registerFileGrantsRpc()
  // Tabs on files opened from outside a project restore with the session, so
  // the files they read have to be readable again before the first tab asks.
  restoreOpenedFiles()
  registerHistoryImportRpc()
  registerModelsRpc()
  registerPolicyRpc()
  registerGitRpc()
  registerRestRpc()
  registerDbRpc()
  registerJupyterRpc()
  registerTasksRpc()
  registerSearchRpc()
  registerFsRpc()
  registerWorkspaceRpc()
  registerSettingsRpc()
  registerSyncRpc()
  registerLspRpc()
  registerDebugRpc()
  registerTerminalRpc()
  registerAgentRpc()
  registerSlidesRpc()
  registerDevServersRpc()

  // App metadata. Under Electron this comes from `app.getVersion()` and
  // `process.versions`; here it is the core's own build, with the browser
  // version left to the shell (the fork's UI knows its own).
  core.register(IpcChannels.appInfo, (): AppInfo => ({
    version: process.env.WEBDECK_VERSION ?? '0.1.0',
    electron: '',
    chrome: process.env.WEBDECK_CHROME_VERSION ?? '',
    platform: process.platform
  }))

  const handle = await serveCoreOverWebSocket(core, {
    port: opts.port ?? 0,
    host: opts.host,
    portFile: opts.portFile,
    authToken: opts.authToken ?? generateCoreToken(),
    // When the last client goes away there is nobody left to answer a pending
    // confirmation, so fail those closed instead of leaving an agent hanging.
    onClientsChanged: (open) => {
      if (open === 0) {
        abortPendingPrompts()
        abortPendingEditorCommands()
      }
    }
  })

  // The reverse bridge: CORE events fan out to every connected WebUI client as
  // `{ type: "event", channel, payload }` frames.
  const push = (channel: string, payload: unknown): number => {
    const frame = JSON.stringify({ type: 'event', channel, payload })
    let delivered = 0
    for (const client of handle.clients) {
      try {
        if (client.readyState === client.OPEN) {
          client.send(frame)
          delivered++
        }
      } catch {
        // a client dropping mid-broadcast is not our problem to handle here
      }
    }
    return delivered
  }

  setCoreBroadcaster((channel, payload) => {
    push(channel, payload)
  })
  // Policy confirmations travel the same way. Delivery is reported honestly: with
  // no client connected there is no one to ask, so the gate fails closed rather
  // than hanging — and the answer returns through the normal policyRespond call.
  // Opening a project must arm the file watcher, exactly as the shell does —
  // without it fsChanged never fires and the Files tree, Document Studio
  // live-reload and Source Control auto-refresh all go stale.
  setWorkspaceOpenedHook((workspace) => {
    watchWorkspace(workspace.path)
    push(IpcEvents.workspaceChanged, workspace)
  })
  setSyncBroadcaster((status) => push(IpcEvents.syncStatusChanged, status))
  setSyncPulledNotifier(() => push(IpcEvents.syncPulled, null))

  setPolicyPromptSink((prompt) => push(IpcEvents.policyPrompt, prompt) > 0)
  setPolicyBroadcaster((status) => push(IpcEvents.policyChanged, status))
  setPolicyDenyNotifier((info) => push(IpcEvents.policyDenied, info))

  // Cross-window deck sync. The main window broadcasts its layout; deck and
  // float windows apply it. The core is the only party every window can
  // reach, so it relays: a broadcast fans out to every client (the sender
  // applies its own state idempotently), a boot-time request asks the main
  // window to broadcast, and a closing window says so.
  core.register(IpcChannels.shellBroadcast, (state) => {
    push(IpcEvents.shellSync, state)
  })
  core.register(IpcChannels.shellRequestSync, () => {
    push(IpcEvents.requestSync, null)
  })
  core.register(IpcChannels.windowClosed, (role, groupId) => {
    if (role === 'deck') push(IpcEvents.deckWindowClosed, null)
    else if (role === 'float' && typeof groupId === 'string')
      push(IpcEvents.floatWindowClosed, groupId)
  })

  // The agent's editor tools: the request goes to the shell (which owns VS
  // Code's command service) as an event, and the answer comes back on its own
  // RPC — same shape as a policy prompt, same fail-closed rules.
  setEditorCommandSink((request) => push(IpcEvents.editorCommandRequest, request) > 0)
  core.register(IpcChannels.editorCommandRespond, (id, response) => {
    respondEditorCommand(String(id), (response ?? {}) as EditorCommandResponse)
  })

  // The agent's browser. Without this the browser tools throw "no browser
  // attached" — which is what the fork did until now, so the agent could plan
  // and edit but never verify its own work in a page.
  //
  // decide/audit are passed in rather than imported by the browser module, so
  // the navigation guard re-checks every redirect against the live policy
  // exactly as the Electron guard does.
  if (opts.agentBrowserPath !== null) {
    // Session mode drives the user's OWN tabs, through the page and Mojo — no
    // port anywhere. Isolated mode spawns a throwaway-profile browser over CDP.
    // Session is the mode that matters for real work; isolated is for pages
    // that are not trusted.
    const agentBrowser =
      opts.agentBrowserMode === 'session'
        ? pageAgentBrowser({
            channel: handle,
            decide: (kind, detail) => decide(kind as PolicyActionKind, detail),
            audit: (entry) => audit(entry as Parameters<typeof audit>[0])
          })
        : chromiumAgentBrowser({
            browserPath: opts.agentBrowserPath,
            decide: (kind, detail) => decide(kind as PolicyActionKind, detail),
            audit: (entry) => audit(entry as Parameters<typeof audit>[0])
          })
    setAgentBrowserPort(agentBrowser)
    // Chromium's helper processes do not exit with the core, so closing the
    // server has to take the agent's browser down too — otherwise every core
    // restart strands a browser tree and a temp profile.
    const closeTransport = handle.close.bind(handle)
    handle.close = async (): Promise<void> => {
      await agentBrowser.shutdown?.().catch(() => {})
      await closeTransport()
    }
  }

  return handle
}
