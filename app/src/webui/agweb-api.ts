import { IpcChannels, IpcEvents } from '@shared/ipc'
import type { UpdateStatus } from '@shared/updates'
import type {
  AgwebApi,
  AppSettings,
  HostCapabilities,
  BrowserTabState,
  DevServerStatus,
  DownloadInfo,
  EditorCommandRequest,
  JupyterOutput,
  PermissionRequestInfo,
  PolicyPromptInfo,
  PolicyDeniedInfo,
  PolicyStatus,
  SyncStatus,
  WorkspaceInfo
} from '@shared/ipc'
import type { DeckSyncState } from '@shared/deck'
import type { AgentSessionInfo } from '@shared/agents'

/**
 * The one construction of the `window.agweb` surface, shared by both hosts.
 *
 * Under Electron the transport is `ipcRenderer`; under the Chromium fork it is a
 * WebSocket client to `webdeck-core` (see `src/webui/`). Injecting the transport
 * rather than importing it means the two hosts can never drift: every channel,
 * every event, every argument shape is defined exactly once, here.
 */

/** The transport surface this API needs — `ipcRenderer` satisfies it as-is. */
export interface IpcLike {
  // `any` mirrors Electron's own ipcRenderer.invoke signature: each call site
  // below is typed by AgwebApi, which is where the real contract lives.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke(channel: string, ...args: unknown[]): Promise<any>
  // Listener args vary per channel; each call site below narrows them, and
  // AgwebApi is where the real contract lives.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  on(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): unknown
  /* eslint-enable @typescript-eslint/no-explicit-any */
  send(channel: string, ...args: unknown[]): void
  sendSync(channel: string, ...args: unknown[]): unknown
}

export function createAgwebApi(ipcRenderer: IpcLike, host: HostCapabilities): AgwebApi {
  const api: AgwebApi = {
    host,
    getAppInfo: () => ipcRenderer.invoke(IpcChannels.appInfo),
    openWorkspace: () => ipcRenderer.invoke(IpcChannels.workspaceOpen),
    openWorkspacePath: (path) => ipcRenderer.invoke(IpcChannels.workspaceOpenPath, path),
    getCurrentWorkspace: () => ipcRenderer.invoke(IpcChannels.workspaceCurrent),
    getRecentProjects: () => ipcRenderer.invoke(IpcChannels.workspaceRecent),
    setTheme: (source) => ipcRenderer.invoke(IpcChannels.themeSet, source),
    onThemeChanged: (listener: (theme: 'light' | 'dark') => void) => {
      const handler = (_event: unknown, theme: 'light' | 'dark'): void => listener(theme)
      ipcRenderer.on(IpcEvents.themeChanged, handler)
      return () => ipcRenderer.removeListener(IpcEvents.themeChanged, handler)
    },
    onWorkspaceChanged: (listener) => {
      const handler = (_event: unknown, workspace: WorkspaceInfo): void => listener(workspace)
      ipcRenderer.on(IpcEvents.workspaceChanged, handler)
      return () => ipcRenderer.removeListener(IpcEvents.workspaceChanged, handler)
    },
    browser: {
      create: (tabId) => ipcRenderer.invoke(IpcChannels.browserCreate, tabId),
      destroy: (tabId) => ipcRenderer.invoke(IpcChannels.browserDestroy, tabId),
      navigate: (tabId, url) => ipcRenderer.invoke(IpcChannels.browserNavigate, tabId, url),
      back: (tabId) => ipcRenderer.invoke(IpcChannels.browserBack, tabId),
      forward: (tabId) => ipcRenderer.invoke(IpcChannels.browserForward, tabId),
      reload: (tabId, ignoreCache) =>
        ipcRenderer.invoke(IpcChannels.browserReload, tabId, ignoreCache),
      stop: (tabId) => ipcRenderer.invoke(IpcChannels.browserStop, tabId),
      setBounds: (tabId, rect) => ipcRenderer.invoke(IpcChannels.browserSetBounds, tabId, rect),
      setVisible: (tabId, visible) =>
        ipcRenderer.invoke(IpcChannels.browserSetVisible, tabId, visible),
      setCornerRadius: (tabId, radius) =>
        ipcRenderer.invoke(IpcChannels.browserSetCornerRadius, tabId, radius),
      captureStage: (tabId) => ipcRenderer.invoke(IpcChannels.browserCaptureStage, tabId),
      openDevTools: (tabId) => ipcRenderer.invoke(IpcChannels.browserDevTools, tabId),
      find: (tabId, query, next) => ipcRenderer.invoke(IpcChannels.browserFind, tabId, query, next),
      findStop: (tabId) => ipcRenderer.invoke(IpcChannels.browserFindStop, tabId),
      zoom: (tabId, level) => ipcRenderer.invoke(IpcChannels.browserZoom, tabId, level),
      print: (tabId) => ipcRenderer.invoke(IpcChannels.browserPrint, tabId),
      onFindResult: (listener) => {
        const handler = (
          _e: unknown,
          result: { tabId: string; matches: number; active: number }
        ): void => listener(result)
        ipcRenderer.on(IpcEvents.browserFindResult, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserFindResult, handler)
      },
      onState: (listener) => {
        const handler = (_event: unknown, state: BrowserTabState): void => listener(state)
        ipcRenderer.on(IpcEvents.browserState, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserState, handler)
      },
      onOpenTab: (listener) => {
        const handler = (_event: unknown, url: string): void => listener(url)
        ipcRenderer.on(IpcEvents.browserOpenTab, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserOpenTab, handler)
      },
      onAdoptTab: (listener) => {
        const handler = (_event: unknown, payload: { tabId: string; url: string }): void =>
          listener(payload.tabId, payload.url)
        ipcRenderer.on(IpcEvents.browserAdoptTab, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserAdoptTab, handler)
      },
      onDocumentsDropped: (listener) => {
        const handler = (_event: unknown, files: { path: string; auth: string }[]): void =>
          listener(files)
        ipcRenderer.on(IpcEvents.browserDocumentsDropped, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserDocumentsDropped, handler)
      },
      onCommand: (listener) => {
        const handler = (_event: unknown, command: string): void => listener(command)
        ipcRenderer.on(IpcEvents.browserCommand, handler)
        return () => ipcRenderer.removeListener(IpcEvents.browserCommand, handler)
      }
    },
    appSettings: {
      read: () => ipcRenderer.invoke(IpcChannels.appSettingsRead),
      readSync: () => ipcRenderer.sendSync(IpcChannels.appSettingsReadSync) as AppSettings,
      write: (patch) => ipcRenderer.invoke(IpcChannels.appSettingsWrite, patch),
      clearData: (kinds) => ipcRenderer.invoke(IpcChannels.appSettingsClearData, kinds),
      chooseDownloadDir: () => ipcRenderer.invoke(IpcChannels.appSettingsChooseDownloadDir)
    },
    secrets: {
      list: () => ipcRenderer.invoke(IpcChannels.secretsList),
      set: (provider, key) => ipcRenderer.invoke(IpcChannels.secretsSet, provider, key),
      clear: (provider) => ipcRenderer.invoke(IpcChannels.secretsClear, provider),
      setSource: (config) => ipcRenderer.invoke(IpcChannels.secretsSetSource, config)
    },
    editor: {
      respondCommand: (id, response) =>
        ipcRenderer.invoke(IpcChannels.editorCommandRespond, id, response),
      onCommandRequest: (listener) => {
        const handler = (_event: unknown, request: EditorCommandRequest): void => listener(request)
        ipcRenderer.on(IpcEvents.editorCommandRequest, handler)
        return () => ipcRenderer.removeListener(IpcEvents.editorCommandRequest, handler)
      }
    },
    vsx: {
      search: (query) => ipcRenderer.invoke(IpcChannels.vsxSearch, query),
      install: (id) => ipcRenderer.invoke(IpcChannels.vsxInstall, id),
      uninstall: (id) => ipcRenderer.invoke(IpcChannels.vsxUninstall, id),
      list: () => ipcRenderer.invoke(IpcChannels.vsxList),
      read: (dir, rel) => ipcRenderer.invoke(IpcChannels.vsxRead, dir, rel),
      hostOrigin: () => ipcRenderer.invoke(IpcChannels.vsxHostOrigin)
    },
    profiles: {
      list: () => ipcRenderer.invoke(IpcChannels.profilesList),
      setActive: (id) => ipcRenderer.invoke(IpcChannels.profilesSetActive, id),
      create: (name) => ipcRenderer.invoke(IpcChannels.profilesCreate, name),
      remove: (id) => ipcRenderer.invoke(IpcChannels.profilesRemove, id),
      googleStatus: () => ipcRenderer.invoke(IpcChannels.profilesGoogleStatus),
      account: () => ipcRenderer.invoke(IpcChannels.profilesAccount)
    },
    files: {
      openSigned: (path, auth) => ipcRenderer.invoke(IpcChannels.filesOpenSigned, path, auth)
    },
    bookmarks: {
      importFile: () => ipcRenderer.invoke(IpcChannels.bookmarksImportFile)
    },
    history: {
      sources: () => ipcRenderer.invoke(IpcChannels.historySources),
      importFrom: (id, limit) => ipcRenderer.invoke(IpcChannels.historyImport, id, limit)
    },
    windows: {
      newWindow: () => ipcRenderer.invoke(IpcChannels.windowNew),
      openDeck: () => ipcRenderer.invoke(IpcChannels.deckOpen),
      closeDeck: () => ipcRenderer.invoke(IpcChannels.deckClose),
      focusDeck: () => ipcRenderer.invoke(IpcChannels.deckFocus),
      syncFloats: (groupIds) => ipcRenderer.invoke(IpcChannels.floatSync, groupIds),
      requestSync: () => ipcRenderer.invoke(IpcChannels.shellRequestSync),
      notifyClosed: (role, groupId) => ipcRenderer.invoke(IpcChannels.windowClosed, role, groupId),
      broadcastState: (state) => ipcRenderer.invoke(IpcChannels.shellBroadcast, state),
      onStateSync: (listener) => {
        const handler = (_event: unknown, state: DeckSyncState): void => listener(state)
        ipcRenderer.on(IpcEvents.shellSync, handler)
        return () => ipcRenderer.removeListener(IpcEvents.shellSync, handler)
      },
      onRequestSync: (listener) => {
        const handler = (): void => listener()
        ipcRenderer.on(IpcEvents.requestSync, handler)
        return () => ipcRenderer.removeListener(IpcEvents.requestSync, handler)
      },
      onDeckClosed: (listener) => {
        const handler = (): void => listener()
        ipcRenderer.on(IpcEvents.deckWindowClosed, handler)
        return () => ipcRenderer.removeListener(IpcEvents.deckWindowClosed, handler)
      },
      onFloatClosed: (listener) => {
        const handler = (_event: unknown, groupId: string): void => listener(groupId)
        ipcRenderer.on(IpcEvents.floatWindowClosed, handler)
        return () => ipcRenderer.removeListener(IpcEvents.floatWindowClosed, handler)
      }
    },
    workspaceRoots: () => ipcRenderer.invoke(IpcChannels.workspaceRoots),
    addWorkspaceRoot: (path) => ipcRenderer.invoke(IpcChannels.workspaceAddRoot, path),
    removeWorkspaceRoot: (path) => ipcRenderer.invoke(IpcChannels.workspaceRemoveRoot, path),

    fs: {
      list: (rel) => ipcRenderer.invoke(IpcChannels.fsList, rel),
      writeBase64: (rel, base64) => ipcRenderer.invoke(IpcChannels.fsWriteBase64, rel, base64),
      read: (rel) => ipcRenderer.invoke(IpcChannels.fsRead, rel),
      write: (rel, content) => ipcRenderer.invoke(IpcChannels.fsWrite, rel, content),
      create: (rel, kind) => ipcRenderer.invoke(IpcChannels.fsCreate, rel, kind),
      rename: (fromRel, toRel) => ipcRenderer.invoke(IpcChannels.fsRename, fromRel, toRel),
      remove: (rel) => ipcRenderer.invoke(IpcChannels.fsDelete, rel),
      onChanged: (listener) => {
        const handler = (): void => listener()
        ipcRenderer.on(IpcEvents.fsChanged, handler)
        return () => ipcRenderer.removeListener(IpcEvents.fsChanged, handler)
      }
    },
    confirm: (message) => ipcRenderer.invoke(IpcChannels.dialogConfirm, message),
    pickPaths: (mode) => ipcRenderer.invoke(IpcChannels.dialogPickPaths, mode),
    search: (query) => ipcRenderer.invoke(IpcChannels.searchQuery, query),
    exports: {
      html: (html, name) => ipcRenderer.invoke(IpcChannels.exportHtml, html, name),
      pdf: (html, name) => ipcRenderer.invoke(IpcChannels.exportPdf, html, name),
      capture: (rect, name) => ipcRenderer.invoke(IpcChannels.exportCapture, rect, name)
    },
    updates: {
      status: () => ipcRenderer.invoke(IpcChannels.updatesStatus),
      check: () => ipcRenderer.invoke(IpcChannels.updatesCheck),
      dismiss: (version) => ipcRenderer.invoke(IpcChannels.updatesDismiss, version),
      download: () => ipcRenderer.invoke(IpcChannels.updatesDownload),
      cancelDownload: () => ipcRenderer.invoke(IpcChannels.updatesCancelDownload),
      reveal: () => ipcRenderer.invoke(IpcChannels.updatesReveal),
      onChanged: (listener) => {
        const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
        ipcRenderer.on(IpcEvents.updateStatusChanged, handler)
        return () => ipcRenderer.removeListener(IpcEvents.updateStatusChanged, handler)
      }
    },
    models: {
      list: () => ipcRenderer.invoke(IpcChannels.modelsList),
      use: (role, id) => ipcRenderer.invoke(IpcChannels.modelsUse, role, id),
      status: () => ipcRenderer.invoke(IpcChannels.modelsStatus),
      start: (provider) => ipcRenderer.invoke(IpcChannels.modelsStart, provider)
    },
    agents: {
      start: (task, attachments) => ipcRenderer.invoke(IpcChannels.agentStart, task, attachments),
      ask: (askId, prompt, context, provider) =>
        ipcRenderer.invoke(IpcChannels.agentAsk, askId, prompt, context, provider),
      geminiAvailable: () => ipcRenderer.invoke(IpcChannels.agentGeminiAvailable),
      onAskToken: (listener) => {
        const handler = (_e: unknown, payload: { askId: string; token: string }): void =>
          listener(payload)
        ipcRenderer.on(IpcEvents.agentAskToken, handler)
        return () => ipcRenderer.removeListener(IpcEvents.agentAskToken, handler)
      },
      chatPage: (chatId, question, pageText, url, title) =>
        ipcRenderer.invoke(IpcChannels.chatPage, chatId, question, pageText, url, title),
      onChatPageToken: (listener) => {
        const handler = (_e: unknown, payload: { chatId: string; token: string }): void =>
          listener(payload)
        ipcRenderer.on(IpcEvents.chatPageToken, handler)
        return () => ipcRenderer.removeListener(IpcEvents.chatPageToken, handler)
      },
      editCode: (editId, instruction, code, language) =>
        ipcRenderer.invoke(IpcChannels.agentEditCode, editId, instruction, code, language),
      onEditToken: (listener) => {
        const handler = (_e: unknown, payload: { editId: string; token: string }): void =>
          listener(payload)
        ipcRenderer.on(IpcEvents.agentEditToken, handler)
        return () => ipcRenderer.removeListener(IpcEvents.agentEditToken, handler)
      },
      cancel: (id) => ipcRenderer.invoke(IpcChannels.agentCancel, id),
      approve: (id) => ipcRenderer.invoke(IpcChannels.agentApprove, id),
      reject: (id) => ipcRenderer.invoke(IpcChannels.agentReject, id),
      stop: (id) => ipcRenderer.invoke(IpcChannels.agentStop, id),
      updatePlan: (id, steps) => ipcRenderer.invoke(IpcChannels.agentUpdatePlan, id, steps),
      resume: (id) => ipcRenderer.invoke(IpcChannels.agentResume, id),
      list: () => ipcRenderer.invoke(IpcChannels.agentList),
      keyStatus: () => ipcRenderer.invoke(IpcChannels.agentKeyStatus),
      setKey: (key) => ipcRenderer.invoke(IpcChannels.agentSetKey, key),
      setModel: (model) => ipcRenderer.invoke(IpcChannels.agentSetModel, model),
      openReport: (id) => ipcRenderer.invoke(IpcChannels.agentOpenReport, id),
      clearFinished: () => ipcRenderer.invoke(IpcChannels.agentClearFinished),
      rename: (id, title) => ipcRenderer.invoke(IpcChannels.agentRename, id, title),
      remove: (id) => ipcRenderer.invoke(IpcChannels.agentDelete, id),
      export: (id, format) => ipcRenderer.invoke(IpcChannels.agentExport, id, format),
      onUpdate: (listener) => {
        const handler = (_event: unknown, session: AgentSessionInfo): void => listener(session)
        ipcRenderer.on(IpcEvents.agentUpdate, handler)
        return () => ipcRenderer.removeListener(IpcEvents.agentUpdate, handler)
      },
      onReset: (listener) => {
        const handler = (_event: unknown, sessions: AgentSessionInfo[]): void => listener(sessions)
        ipcRenderer.on(IpcEvents.agentSessionsReset, handler)
        return () => ipcRenderer.removeListener(IpcEvents.agentSessionsReset, handler)
      }
    },
    debug: {
      available: () => ipcRenderer.invoke(IpcChannels.debugAvailable),
      start: () => ipcRenderer.invoke(IpcChannels.debugStart),
      attachChild: (sessionId) => ipcRenderer.invoke(IpcChannels.debugAttachChild, sessionId),
      send: (sessionId, message) => ipcRenderer.send(IpcChannels.debugSend, sessionId, message),
      stop: () => ipcRenderer.invoke(IpcChannels.debugStop),
      onMessage: (listener) => {
        const handler = (_e: unknown, payload: { sessionId: string; message: unknown }): void =>
          listener(payload)
        ipcRenderer.on(IpcEvents.debugMessage, handler)
        return () => ipcRenderer.removeListener(IpcEvents.debugMessage, handler)
      },
      onExit: (listener) => {
        const handler = (): void => listener()
        ipcRenderer.on(IpcEvents.debugExit, handler)
        return () => ipcRenderer.removeListener(IpcEvents.debugExit, handler)
      }
    },

    settings: {
      read: () => ipcRenderer.invoke(IpcChannels.settingsRead),
      write: (scope, text) => ipcRenderer.invoke(IpcChannels.settingsWrite, scope, text),
      import: () => ipcRenderer.invoke(IpcChannels.settingsImport)
    },

    tasks: {
      list: () => ipcRenderer.invoke(IpcChannels.taskList),
      run: (name) => ipcRenderer.invoke(IpcChannels.taskRun, name),
      stop: (name) => ipcRenderer.invoke(IpcChannels.taskStop, name),
      runs: () => ipcRenderer.invoke(IpcChannels.taskRuns),
      onUpdate: (listener) => {
        const handler = (_e: unknown, run: import('@shared/tasks').TaskRun): void => listener(run)
        ipcRenderer.on(IpcEvents.taskUpdate, handler)
        return () => ipcRenderer.removeListener(IpcEvents.taskUpdate, handler)
      }
    },

    git: {
      status: () => ipcRenderer.invoke(IpcChannels.gitStatus),
      diff: (path, staged) => ipcRenderer.invoke(IpcChannels.gitDiff, path, staged),
      stage: (paths) => ipcRenderer.invoke(IpcChannels.gitStage, paths),
      unstage: (paths) => ipcRenderer.invoke(IpcChannels.gitUnstage, paths),
      commit: (message) => ipcRenderer.invoke(IpcChannels.gitCommit, message),
      branches: () => ipcRenderer.invoke(IpcChannels.gitBranches),
      checkout: (branch) => ipcRenderer.invoke(IpcChannels.gitCheckout, branch),
      blame: (path) => ipcRenderer.invoke(IpcChannels.gitBlame, path),
      logGraph: (limit) => ipcRenderer.invoke(IpcChannels.gitLogGraph, limit),
      show: (hash) => ipcRenderer.invoke(IpcChannels.gitShow, hash)
    },

    rest: {
      send: (request) => ipcRenderer.invoke(IpcChannels.restSend, request)
    },

    db: {
      connect: (path, readonly) => ipcRenderer.invoke(IpcChannels.dbConnect, path, readonly),
      query: (id, sql, params) => ipcRenderer.invoke(IpcChannels.dbQuery, id, sql, params),
      tables: (id) => ipcRenderer.invoke(IpcChannels.dbTables, id),
      close: (id) => ipcRenderer.invoke(IpcChannels.dbClose, id)
    },

    jupyter: {
      connect: (baseUrl, token) => ipcRenderer.invoke(IpcChannels.jupyterConnect, baseUrl, token),
      startKernel: (name) => ipcRenderer.invoke(IpcChannels.jupyterStartKernel, name),
      execute: (execId, code) => ipcRenderer.invoke(IpcChannels.jupyterExecute, execId, code),
      interrupt: () => ipcRenderer.invoke(IpcChannels.jupyterInterrupt),
      disconnect: () => ipcRenderer.invoke(IpcChannels.jupyterDisconnect),
      onOutput: (listener) => {
        const handler = (_e: unknown, payload: { execId: string; output: JupyterOutput }): void =>
          listener(payload)
        ipcRenderer.on(IpcEvents.jupyterOutput, handler)
        return () => ipcRenderer.removeListener(IpcEvents.jupyterOutput, handler)
      }
    },

    lsp: {
      start: (id) => ipcRenderer.invoke(IpcChannels.lspStart, id),
      send: (id, message) => ipcRenderer.send(IpcChannels.lspSend, id, message),
      stop: (id) => ipcRenderer.invoke(IpcChannels.lspStop, id),
      onMessage: (listener) => {
        const handler = (_e: unknown, payload: { id: string; message: unknown }): void =>
          listener(payload.id, payload.message)
        ipcRenderer.on(IpcEvents.lspMessage, handler)
        return () => ipcRenderer.removeListener(IpcEvents.lspMessage, handler)
      },
      onExit: (listener) => {
        const handler = (_e: unknown, payload: { id: string }): void => listener(payload.id)
        ipcRenderer.on(IpcEvents.lspExit, handler)
        return () => ipcRenderer.removeListener(IpcEvents.lspExit, handler)
      }
    },

    extensions: {
      load: () => ipcRenderer.invoke(IpcChannels.extLoad),
      loadPacked: () => ipcRenderer.invoke(IpcChannels.extLoadPacked),
      loadPath: (path) => ipcRenderer.invoke(IpcChannels.extLoadPath, path),
      list: () => ipcRenderer.invoke(IpcChannels.extList),
      remove: (id) => ipcRenderer.invoke(IpcChannels.extRemove, id),
      // Pinned toolbar actions, for the tab the user is looking at.
      actions: (tabId) => ipcRenderer.invoke(IpcChannels.extensionsActions, tabId),
      runAction: (tabId, id) => ipcRenderer.invoke(IpcChannels.extensionsRunAction, tabId, id)
    },
    embedProxy: {
      status: () => ipcRenderer.invoke(IpcChannels.proxyStatus),
      setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.proxySetEnabled, enabled)
    },
    downloads: {
      list: () => ipcRenderer.invoke(IpcChannels.downloadsList),
      show: (id) => ipcRenderer.invoke(IpcChannels.downloadsShow, id),
      clear: () => ipcRenderer.invoke(IpcChannels.downloadsClear),
      onUpdate: (listener) => {
        const handler = (_event: unknown, download: DownloadInfo): void => listener(download)
        ipcRenderer.on(IpcEvents.downloadUpdate, handler)
        return () => ipcRenderer.removeListener(IpcEvents.downloadUpdate, handler)
      }
    },
    permissions: {
      respond: (id, allow, remember) =>
        ipcRenderer.invoke(IpcChannels.permissionRespond, id, allow, remember),
      onRequest: (listener) => {
        const handler = (_event: unknown, request: PermissionRequestInfo): void => listener(request)
        ipcRenderer.on(IpcEvents.permissionRequest, handler)
        return () => ipcRenderer.removeListener(IpcEvents.permissionRequest, handler)
      }
    },
    devServer: {
      start: (mode) => ipcRenderer.invoke(IpcChannels.devServerStart, mode),
      stop: () => ipcRenderer.invoke(IpcChannels.devServerStop),
      status: () => ipcRenderer.invoke(IpcChannels.devServerStatus),
      onUpdate: (listener) => {
        const handler = (_event: unknown, status: DevServerStatus): void => listener(status)
        ipcRenderer.on(IpcEvents.devServerUpdate, handler)
        return () => ipcRenderer.removeListener(IpcEvents.devServerUpdate, handler)
      }
    },
    slides: {
      open: (rel) => ipcRenderer.invoke(IpcChannels.slidesOpen, rel)
    },
    onShellShortcut: (listener) => {
      const handler = (_event: unknown, combo: string): void => listener(combo)
      ipcRenderer.on(IpcEvents.shellShortcut, handler)
      return () => ipcRenderer.removeListener(IpcEvents.shellShortcut, handler)
    },
    policy: {
      get: () => ipcRenderer.invoke(IpcChannels.policyGet),
      setMode: (mode) => ipcRenderer.invoke(IpcChannels.policySetMode, mode),
      setCustom: (rules) => ipcRenderer.invoke(IpcChannels.policySetCustom, rules),
      setSite: (host, decision) => ipcRenderer.invoke(IpcChannels.policySetSite, host, decision),
      clearSite: (host) => ipcRenderer.invoke(IpcChannels.policyClearSite, host),
      setGuard: (guard, enabled) => ipcRenderer.invoke(IpcChannels.policySetGuard, guard, enabled),
      respond: (id, allow, always) =>
        ipcRenderer.invoke(IpcChannels.policyRespond, id, allow, always),
      onPrompt: (listener) => {
        const handler = (_event: unknown, prompt: PolicyPromptInfo): void => listener(prompt)
        ipcRenderer.on(IpcEvents.policyPrompt, handler)
        return () => ipcRenderer.removeListener(IpcEvents.policyPrompt, handler)
      },
      onChanged: (listener) => {
        const handler = (_event: unknown, status: PolicyStatus): void => listener(status)
        ipcRenderer.on(IpcEvents.policyChanged, handler)
        return () => ipcRenderer.removeListener(IpcEvents.policyChanged, handler)
      },
      onDenied: (listener) => {
        const handler = (_event: unknown, info: PolicyDeniedInfo): void => listener(info)
        ipcRenderer.on(IpcEvents.policyDenied, handler)
        return () => ipcRenderer.removeListener(IpcEvents.policyDenied, handler)
      }
    },
    sync: {
      status: () => ipcRenderer.invoke(IpcChannels.syncStatus),
      chooseFile: () => ipcRenderer.invoke(IpcChannels.syncChooseFile),
      setEnabled: (enabled: boolean) => ipcRenderer.invoke(IpcChannels.syncSetEnabled, enabled),
      pushNow: () => ipcRenderer.invoke(IpcChannels.syncPushNow),
      pullNow: () => ipcRenderer.invoke(IpcChannels.syncPullNow),
      onChanged: (listener: (status: SyncStatus) => void) => {
        const handler = (_event: unknown, status: SyncStatus): void => listener(status)
        ipcRenderer.on(IpcEvents.syncStatusChanged, handler)
        return () => ipcRenderer.removeListener(IpcEvents.syncStatusChanged, handler)
      },
      onPulled: (listener: () => void) => {
        const handler = (): void => listener()
        ipcRenderer.on(IpcEvents.syncPulled, handler)
        return () => ipcRenderer.removeListener(IpcEvents.syncPulled, handler)
      }
    },
    terminal: {
      create: (id, cols, rows) => ipcRenderer.invoke(IpcChannels.termCreate, id, cols, rows),
      input: (id, data) => ipcRenderer.invoke(IpcChannels.termInput, id, data),
      resize: (id, cols, rows) => ipcRenderer.invoke(IpcChannels.termResize, id, cols, rows),
      dispose: (id) => ipcRenderer.invoke(IpcChannels.termDispose, id),
      stop: (id) => ipcRenderer.invoke(IpcChannels.termStop, id),
      attach: (id) => ipcRenderer.invoke(IpcChannels.termAttach, id),
      onData: (listener) => {
        const handler = (_e: unknown, payload: { id: string; data: string }): void =>
          listener(payload.id, payload.data)
        ipcRenderer.on(IpcEvents.termData, handler)
        return () => ipcRenderer.removeListener(IpcEvents.termData, handler)
      },
      onExit: (listener) => {
        const handler = (_e: unknown, payload: { id: string; code: number }): void =>
          listener(payload.id, payload.code)
        ipcRenderer.on(IpcEvents.termExit, handler)
        return () => ipcRenderer.removeListener(IpcEvents.termExit, handler)
      },
      onAdopt: (listener) => {
        const handler = (_e: unknown, payload: { id: string; title: string }): void =>
          listener(payload.id, payload.title)
        ipcRenderer.on(IpcEvents.terminalAdopt, handler)
        return () => ipcRenderer.removeListener(IpcEvents.terminalAdopt, handler)
      }
    }
  }

  return api
}
