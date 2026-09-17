// GENERATED from out/webdeck-release by scripts/gen-mojo-bindings.mjs — do not edit.

// ../../../../../Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck-release/gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-webui.ts
import { mojo } from "//resources/mojo/mojo/public/js/bindings.js";
import {
  RectSpec as gfx_mojom_RectSpec
} from "//resources/mojo/ui/gfx/geometry/mojom/geometry.mojom-webui.js";
var AgentTabsPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.AgentTabs",
      scope
    );
  }
};
var AgentTabsRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      AgentTabsPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  openTab(url) {
    return this.proxy.sendMessage(
      102408508,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      [
        url
      ],
      false
    );
  }
  sendCommand(tabId, method, paramsJson) {
    return this.proxy.sendMessage(
      2140779076,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      [
        tabId,
        method,
        paramsJson
      ],
      false
    );
  }
  closeTab(tabId) {
    return this.proxy.sendMessage(
      845785937,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  setClient(client) {
    this.proxy.sendMessage(
      777262655,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      [
        client
      ],
      false
    );
  }
};
var AgentTabsReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      102408508,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      impl.openTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2140779076,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      impl.sendCommand.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      845785937,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      impl.closeTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      777262655,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      impl.setClient.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var AgentTabs = class {
  static get $interfaceName() {
    return "webdeck.mojom.AgentTabs";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new AgentTabsRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var AgentTabsCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  openTab;
  sendCommand;
  closeTab;
  setClient;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.openTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      102408508,
      AgentTabs_OpenTab_ParamsSpec.$,
      AgentTabs_OpenTab_ResponseParamsSpec.$,
      this.openTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.sendCommand = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2140779076,
      AgentTabs_SendCommand_ParamsSpec.$,
      AgentTabs_SendCommand_ResponseParamsSpec.$,
      this.sendCommand.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.closeTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      845785937,
      AgentTabs_CloseTab_ParamsSpec.$,
      AgentTabs_CloseTab_ResponseParamsSpec.$,
      this.closeTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setClient = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      777262655,
      AgentTabs_SetClient_ParamsSpec.$,
      null,
      this.setClient.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var AgentTabsClientPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.AgentTabsClient",
      scope
    );
  }
};
var AgentTabsClientRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      AgentTabsClientPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  onEvent(tabId, method, paramsJson) {
    this.proxy.sendMessage(
      1095332924,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      [
        tabId,
        method,
        paramsJson
      ],
      false
    );
  }
  onDetached(tabId) {
    this.proxy.sendMessage(
      1471586999,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
};
var AgentTabsClientReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      1095332924,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      impl.onEvent.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1471586999,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      impl.onDetached.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var AgentTabsClient = class {
  static get $interfaceName() {
    return "webdeck.mojom.AgentTabsClient";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new AgentTabsClientRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var AgentTabsClientCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  onEvent;
  onDetached;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      AgentTabsClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.onEvent = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1095332924,
      AgentTabsClient_OnEvent_ParamsSpec.$,
      null,
      this.onEvent.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onDetached = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1471586999,
      AgentTabsClient_OnDetached_ParamsSpec.$,
      null,
      this.onDetached.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var ShellPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.Shell",
      scope
    );
  }
};
var ShellRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      ShellPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  setStageBounds(stage) {
    this.proxy.sendMessage(
      502218115,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      [
        stage
      ],
      false
    );
  }
  setSplit(enabled, primaryTabId, secondaryTabId) {
    this.proxy.sendMessage(
      978132734,
      Shell_SetSplit_ParamsSpec.$,
      null,
      [
        enabled,
        primaryTabId,
        secondaryTabId
      ],
      false
    );
  }
  setSecondaryStageBounds(stage) {
    this.proxy.sendMessage(
      139034168,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      [
        stage
      ],
      false
    );
  }
  createTab(url) {
    return this.proxy.sendMessage(
      1687051038,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      [
        url
      ],
      false
    );
  }
  selectTab(tabId) {
    this.proxy.sendMessage(
      925686128,
      Shell_SelectTab_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  closeTab(tabId) {
    this.proxy.sendMessage(
      1797287965,
      Shell_CloseTab_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  navigate(tabId, url) {
    this.proxy.sendMessage(
      1473720033,
      Shell_Navigate_ParamsSpec.$,
      null,
      [
        tabId,
        url
      ],
      false
    );
  }
  reload(tabId) {
    this.proxy.sendMessage(
      1826718318,
      Shell_Reload_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  reloadShell() {
    this.proxy.sendMessage(
      1595636669,
      Shell_ReloadShell_ParamsSpec.$,
      null,
      [],
      false
    );
  }
  goBack(tabId) {
    this.proxy.sendMessage(
      479597812,
      Shell_GoBack_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  goForward(tabId) {
    this.proxy.sendMessage(
      2106477657,
      Shell_GoForward_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  stop(tabId) {
    this.proxy.sendMessage(
      1320450855,
      Shell_Stop_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  setStageCornerRadius(radius) {
    this.proxy.sendMessage(
      631760253,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      [
        radius
      ],
      false
    );
  }
  find(tabId, query, forward) {
    this.proxy.sendMessage(
      511445982,
      Shell_Find_ParamsSpec.$,
      null,
      [
        tabId,
        query,
        forward
      ],
      false
    );
  }
  stopFind(tabId) {
    this.proxy.sendMessage(
      252080144,
      Shell_StopFind_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  setZoom(tabId, level) {
    return this.proxy.sendMessage(
      713335880,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      [
        tabId,
        level
      ],
      false
    );
  }
  print(tabId) {
    this.proxy.sendMessage(
      216270657,
      Shell_Print_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  openDevTools(tabId) {
    this.proxy.sendMessage(
      494096774,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  togglePictureInPicture(tabId) {
    this.proxy.sendMessage(
      790647368,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  getPageText(tabId) {
    return this.proxy.sendMessage(
      1813493965,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  getBlockThirdPartyCookies() {
    return this.proxy.sendMessage(
      1427666857,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setBlockThirdPartyCookies(blocked) {
    this.proxy.sendMessage(
      278838813,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      [
        blocked
      ],
      false
    );
  }
  getSendDoNotTrack() {
    return this.proxy.sendMessage(
      285803864,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setSendDoNotTrack(enabled) {
    this.proxy.sendMessage(
      2102454249,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getHttpsOnlyMode() {
    return this.proxy.sendMessage(
      836490945,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setHttpsOnlyMode(enabled) {
    this.proxy.sendMessage(
      1673103613,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getPreloadPages() {
    return this.proxy.sendMessage(
      1374262588,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setPreloadPages(enabled) {
    this.proxy.sendMessage(
      723369275,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getAdblockEnabled() {
    return this.proxy.sendMessage(
      32241856,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setAdblockEnabled(enabled) {
    this.proxy.sendMessage(
      821112473,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      [
        enabled
      ],
      false
    );
  }
  getAdblockBlockedCount() {
    return this.proxy.sendMessage(
      73501288,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      [],
      false
    );
  }
  clearBrowsingData(cookies, cache, history, timeRange) {
    return this.proxy.sendMessage(
      1839527027,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      [
        cookies,
        cache,
        history,
        timeRange
      ],
      false
    );
  }
  getDefaultBrowserState() {
    return this.proxy.sendMessage(
      1142821493,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setAsDefaultBrowser() {
    return this.proxy.sendMessage(
      1150953122,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      [],
      false
    );
  }
  getExtensionActions(tabId) {
    return this.proxy.sendMessage(
      980272239,
      Shell_GetExtensionActions_ParamsSpec.$,
      Shell_GetExtensionActions_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  runExtensionAction(tabId, extensionId) {
    return this.proxy.sendMessage(
      1113325693,
      Shell_RunExtensionAction_ParamsSpec.$,
      Shell_RunExtensionAction_ResponseParamsSpec.$,
      [
        tabId,
        extensionId
      ],
      false
    );
  }
  getSettingPrefs(names) {
    return this.proxy.sendMessage(
      1612867135,
      Shell_GetSettingPrefs_ParamsSpec.$,
      Shell_GetSettingPrefs_ResponseParamsSpec.$,
      [
        names
      ],
      false
    );
  }
  setSettingPref(name, jsonValue) {
    return this.proxy.sendMessage(
      2034579838,
      Shell_SetSettingPref_ParamsSpec.$,
      Shell_SetSettingPref_ResponseParamsSpec.$,
      [
        name,
        jsonValue
      ],
      false
    );
  }
  getAccountInfo() {
    return this.proxy.sendMessage(
      115845584,
      Shell_GetAccountInfo_ParamsSpec.$,
      Shell_GetAccountInfo_ResponseParamsSpec.$,
      [],
      false
    );
  }
  setClient(client) {
    this.proxy.sendMessage(
      1393567653,
      Shell_SetClient_ParamsSpec.$,
      null,
      [
        client
      ],
      false
    );
  }
  setStageVisible(visible) {
    this.proxy.sendMessage(
      1025856066,
      Shell_SetStageVisible_ParamsSpec.$,
      null,
      [
        visible
      ],
      false
    );
  }
  captureStage(tabId) {
    return this.proxy.sendMessage(
      97704177,
      Shell_CaptureStage_ParamsSpec.$,
      Shell_CaptureStage_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
  openWindow(url) {
    return this.proxy.sendMessage(
      1509102986,
      Shell_OpenWindow_ParamsSpec.$,
      Shell_OpenWindow_ResponseParamsSpec.$,
      [
        url
      ],
      false
    );
  }
  focusWindow(windowId) {
    this.proxy.sendMessage(
      1820560745,
      Shell_FocusWindow_ParamsSpec.$,
      null,
      [
        windowId
      ],
      false
    );
  }
  closeWindow(windowId) {
    this.proxy.sendMessage(
      991120878,
      Shell_CloseWindow_ParamsSpec.$,
      null,
      [
        windowId
      ],
      false
    );
  }
  pickPaths(mode) {
    return this.proxy.sendMessage(
      870934368,
      Shell_PickPaths_ParamsSpec.$,
      Shell_PickPaths_ResponseParamsSpec.$,
      [
        mode
      ],
      false
    );
  }
  pickImage() {
    return this.proxy.sendMessage(
      184233421,
      Shell_PickImage_ParamsSpec.$,
      Shell_PickImage_ResponseParamsSpec.$,
      [],
      false
    );
  }
  openLocalFile(tabId) {
    return this.proxy.sendMessage(
      1001832075,
      Shell_OpenLocalFile_ParamsSpec.$,
      Shell_OpenLocalFile_ResponseParamsSpec.$,
      [
        tabId
      ],
      false
    );
  }
};
var ShellReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      502218115,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      impl.setStageBounds.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      978132734,
      Shell_SetSplit_ParamsSpec.$,
      null,
      impl.setSplit.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      139034168,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      impl.setSecondaryStageBounds.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1687051038,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      impl.createTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      925686128,
      Shell_SelectTab_ParamsSpec.$,
      null,
      impl.selectTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1797287965,
      Shell_CloseTab_ParamsSpec.$,
      null,
      impl.closeTab.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1473720033,
      Shell_Navigate_ParamsSpec.$,
      null,
      impl.navigate.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1826718318,
      Shell_Reload_ParamsSpec.$,
      null,
      impl.reload.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1595636669,
      Shell_ReloadShell_ParamsSpec.$,
      null,
      impl.reloadShell.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      479597812,
      Shell_GoBack_ParamsSpec.$,
      null,
      impl.goBack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2106477657,
      Shell_GoForward_ParamsSpec.$,
      null,
      impl.goForward.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1320450855,
      Shell_Stop_ParamsSpec.$,
      null,
      impl.stop.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      631760253,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      impl.setStageCornerRadius.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      511445982,
      Shell_Find_ParamsSpec.$,
      null,
      impl.find.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      252080144,
      Shell_StopFind_ParamsSpec.$,
      null,
      impl.stopFind.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      713335880,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      impl.setZoom.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      216270657,
      Shell_Print_ParamsSpec.$,
      null,
      impl.print.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      494096774,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      impl.openDevTools.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      790647368,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      impl.togglePictureInPicture.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1813493965,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      impl.getPageText.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1427666857,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      impl.getBlockThirdPartyCookies.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      278838813,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      impl.setBlockThirdPartyCookies.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      285803864,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      impl.getSendDoNotTrack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2102454249,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      impl.setSendDoNotTrack.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      836490945,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      impl.getHttpsOnlyMode.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1673103613,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      impl.setHttpsOnlyMode.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1374262588,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      impl.getPreloadPages.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      723369275,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      impl.setPreloadPages.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      32241856,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      impl.getAdblockEnabled.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      821112473,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      impl.setAdblockEnabled.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      73501288,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      impl.getAdblockBlockedCount.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1839527027,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      impl.clearBrowsingData.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1142821493,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      impl.getDefaultBrowserState.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1150953122,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      impl.setAsDefaultBrowser.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      980272239,
      Shell_GetExtensionActions_ParamsSpec.$,
      Shell_GetExtensionActions_ResponseParamsSpec.$,
      impl.getExtensionActions.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1113325693,
      Shell_RunExtensionAction_ParamsSpec.$,
      Shell_RunExtensionAction_ResponseParamsSpec.$,
      impl.runExtensionAction.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1612867135,
      Shell_GetSettingPrefs_ParamsSpec.$,
      Shell_GetSettingPrefs_ResponseParamsSpec.$,
      impl.getSettingPrefs.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2034579838,
      Shell_SetSettingPref_ParamsSpec.$,
      Shell_SetSettingPref_ResponseParamsSpec.$,
      impl.setSettingPref.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      115845584,
      Shell_GetAccountInfo_ParamsSpec.$,
      Shell_GetAccountInfo_ResponseParamsSpec.$,
      impl.getAccountInfo.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1393567653,
      Shell_SetClient_ParamsSpec.$,
      null,
      impl.setClient.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1025856066,
      Shell_SetStageVisible_ParamsSpec.$,
      null,
      impl.setStageVisible.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      97704177,
      Shell_CaptureStage_ParamsSpec.$,
      Shell_CaptureStage_ResponseParamsSpec.$,
      impl.captureStage.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1509102986,
      Shell_OpenWindow_ParamsSpec.$,
      Shell_OpenWindow_ResponseParamsSpec.$,
      impl.openWindow.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1820560745,
      Shell_FocusWindow_ParamsSpec.$,
      null,
      impl.focusWindow.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      991120878,
      Shell_CloseWindow_ParamsSpec.$,
      null,
      impl.closeWindow.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      870934368,
      Shell_PickPaths_ParamsSpec.$,
      Shell_PickPaths_ResponseParamsSpec.$,
      impl.pickPaths.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      184233421,
      Shell_PickImage_ParamsSpec.$,
      Shell_PickImage_ResponseParamsSpec.$,
      impl.pickImage.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1001832075,
      Shell_OpenLocalFile_ParamsSpec.$,
      Shell_OpenLocalFile_ResponseParamsSpec.$,
      impl.openLocalFile.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var Shell = class {
  static get $interfaceName() {
    return "webdeck.mojom.Shell";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new ShellRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var ShellCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  setStageBounds;
  setSplit;
  setSecondaryStageBounds;
  createTab;
  selectTab;
  closeTab;
  navigate;
  reload;
  reloadShell;
  goBack;
  goForward;
  stop;
  setStageCornerRadius;
  find;
  stopFind;
  setZoom;
  print;
  openDevTools;
  togglePictureInPicture;
  getPageText;
  getBlockThirdPartyCookies;
  setBlockThirdPartyCookies;
  getSendDoNotTrack;
  setSendDoNotTrack;
  getHttpsOnlyMode;
  setHttpsOnlyMode;
  getPreloadPages;
  setPreloadPages;
  getAdblockEnabled;
  setAdblockEnabled;
  getAdblockBlockedCount;
  clearBrowsingData;
  getDefaultBrowserState;
  setAsDefaultBrowser;
  getExtensionActions;
  runExtensionAction;
  getSettingPrefs;
  setSettingPref;
  getAccountInfo;
  setClient;
  setStageVisible;
  captureStage;
  openWindow;
  focusWindow;
  closeWindow;
  pickPaths;
  pickImage;
  openLocalFile;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.setStageBounds = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      502218115,
      Shell_SetStageBounds_ParamsSpec.$,
      null,
      this.setStageBounds.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setSplit = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      978132734,
      Shell_SetSplit_ParamsSpec.$,
      null,
      this.setSplit.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setSecondaryStageBounds = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      139034168,
      Shell_SetSecondaryStageBounds_ParamsSpec.$,
      null,
      this.setSecondaryStageBounds.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.createTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1687051038,
      Shell_CreateTab_ParamsSpec.$,
      Shell_CreateTab_ResponseParamsSpec.$,
      this.createTab.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.selectTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      925686128,
      Shell_SelectTab_ParamsSpec.$,
      null,
      this.selectTab.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.closeTab = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1797287965,
      Shell_CloseTab_ParamsSpec.$,
      null,
      this.closeTab.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.navigate = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1473720033,
      Shell_Navigate_ParamsSpec.$,
      null,
      this.navigate.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.reload = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1826718318,
      Shell_Reload_ParamsSpec.$,
      null,
      this.reload.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.reloadShell = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1595636669,
      Shell_ReloadShell_ParamsSpec.$,
      null,
      this.reloadShell.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.goBack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      479597812,
      Shell_GoBack_ParamsSpec.$,
      null,
      this.goBack.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.goForward = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2106477657,
      Shell_GoForward_ParamsSpec.$,
      null,
      this.goForward.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.stop = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1320450855,
      Shell_Stop_ParamsSpec.$,
      null,
      this.stop.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setStageCornerRadius = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      631760253,
      Shell_SetStageCornerRadius_ParamsSpec.$,
      null,
      this.setStageCornerRadius.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.find = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      511445982,
      Shell_Find_ParamsSpec.$,
      null,
      this.find.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.stopFind = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      252080144,
      Shell_StopFind_ParamsSpec.$,
      null,
      this.stopFind.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setZoom = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      713335880,
      Shell_SetZoom_ParamsSpec.$,
      Shell_SetZoom_ResponseParamsSpec.$,
      this.setZoom.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.print = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      216270657,
      Shell_Print_ParamsSpec.$,
      null,
      this.print.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.openDevTools = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      494096774,
      Shell_OpenDevTools_ParamsSpec.$,
      null,
      this.openDevTools.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.togglePictureInPicture = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      790647368,
      Shell_TogglePictureInPicture_ParamsSpec.$,
      null,
      this.togglePictureInPicture.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getPageText = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1813493965,
      Shell_GetPageText_ParamsSpec.$,
      Shell_GetPageText_ResponseParamsSpec.$,
      this.getPageText.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getBlockThirdPartyCookies = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1427666857,
      Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
      Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
      this.getBlockThirdPartyCookies.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setBlockThirdPartyCookies = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      278838813,
      Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
      null,
      this.setBlockThirdPartyCookies.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getSendDoNotTrack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      285803864,
      Shell_GetSendDoNotTrack_ParamsSpec.$,
      Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
      this.getSendDoNotTrack.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setSendDoNotTrack = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2102454249,
      Shell_SetSendDoNotTrack_ParamsSpec.$,
      null,
      this.setSendDoNotTrack.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getHttpsOnlyMode = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      836490945,
      Shell_GetHttpsOnlyMode_ParamsSpec.$,
      Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
      this.getHttpsOnlyMode.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setHttpsOnlyMode = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1673103613,
      Shell_SetHttpsOnlyMode_ParamsSpec.$,
      null,
      this.setHttpsOnlyMode.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getPreloadPages = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1374262588,
      Shell_GetPreloadPages_ParamsSpec.$,
      Shell_GetPreloadPages_ResponseParamsSpec.$,
      this.getPreloadPages.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setPreloadPages = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      723369275,
      Shell_SetPreloadPages_ParamsSpec.$,
      null,
      this.setPreloadPages.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getAdblockEnabled = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      32241856,
      Shell_GetAdblockEnabled_ParamsSpec.$,
      Shell_GetAdblockEnabled_ResponseParamsSpec.$,
      this.getAdblockEnabled.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setAdblockEnabled = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      821112473,
      Shell_SetAdblockEnabled_ParamsSpec.$,
      null,
      this.setAdblockEnabled.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.getAdblockBlockedCount = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      73501288,
      Shell_GetAdblockBlockedCount_ParamsSpec.$,
      Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
      this.getAdblockBlockedCount.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.clearBrowsingData = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1839527027,
      Shell_ClearBrowsingData_ParamsSpec.$,
      Shell_ClearBrowsingData_ResponseParamsSpec.$,
      this.clearBrowsingData.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getDefaultBrowserState = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1142821493,
      Shell_GetDefaultBrowserState_ParamsSpec.$,
      Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
      this.getDefaultBrowserState.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setAsDefaultBrowser = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1150953122,
      Shell_SetAsDefaultBrowser_ParamsSpec.$,
      Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
      this.setAsDefaultBrowser.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getExtensionActions = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      980272239,
      Shell_GetExtensionActions_ParamsSpec.$,
      Shell_GetExtensionActions_ResponseParamsSpec.$,
      this.getExtensionActions.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.runExtensionAction = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1113325693,
      Shell_RunExtensionAction_ParamsSpec.$,
      Shell_RunExtensionAction_ResponseParamsSpec.$,
      this.runExtensionAction.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getSettingPrefs = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1612867135,
      Shell_GetSettingPrefs_ParamsSpec.$,
      Shell_GetSettingPrefs_ResponseParamsSpec.$,
      this.getSettingPrefs.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setSettingPref = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2034579838,
      Shell_SetSettingPref_ParamsSpec.$,
      Shell_SetSettingPref_ResponseParamsSpec.$,
      this.setSettingPref.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.getAccountInfo = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      115845584,
      Shell_GetAccountInfo_ParamsSpec.$,
      Shell_GetAccountInfo_ResponseParamsSpec.$,
      this.getAccountInfo.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.setClient = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1393567653,
      Shell_SetClient_ParamsSpec.$,
      null,
      this.setClient.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.setStageVisible = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1025856066,
      Shell_SetStageVisible_ParamsSpec.$,
      null,
      this.setStageVisible.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.captureStage = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      97704177,
      Shell_CaptureStage_ParamsSpec.$,
      Shell_CaptureStage_ResponseParamsSpec.$,
      this.captureStage.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.openWindow = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1509102986,
      Shell_OpenWindow_ParamsSpec.$,
      Shell_OpenWindow_ResponseParamsSpec.$,
      this.openWindow.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.focusWindow = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1820560745,
      Shell_FocusWindow_ParamsSpec.$,
      null,
      this.focusWindow.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.closeWindow = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      991120878,
      Shell_CloseWindow_ParamsSpec.$,
      null,
      this.closeWindow.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.pickPaths = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      870934368,
      Shell_PickPaths_ParamsSpec.$,
      Shell_PickPaths_ResponseParamsSpec.$,
      this.pickPaths.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.pickImage = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      184233421,
      Shell_PickImage_ParamsSpec.$,
      Shell_PickImage_ResponseParamsSpec.$,
      this.pickImage.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.openLocalFile = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1001832075,
      Shell_OpenLocalFile_ParamsSpec.$,
      Shell_OpenLocalFile_ResponseParamsSpec.$,
      this.openLocalFile.createReceiverHandler(
        true
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var ShellClientPendingReceiver = class {
  handle;
  constructor(handle) {
    this.handle = mojo.internal.interfaceSupport.getEndpointForReceiver(handle);
  }
  bindInBrowser(scope = "context") {
    mojo.internal.interfaceSupport.bind(
      this.handle,
      "webdeck.mojom.ShellClient",
      scope
    );
  }
};
var ShellClientRemote = class {
  proxy;
  $;
  onConnectionError;
  constructor(handle) {
    this.proxy = new mojo.internal.interfaceSupport.InterfaceRemoteBase(
      ShellClientPendingReceiver,
      handle
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceRemoteBaseWrapper(this.proxy);
    this.onConnectionError = this.proxy.getConnectionErrorEventRouter();
  }
  onDocumentsDropped(files) {
    this.proxy.sendMessage(
      1435046940,
      ShellClient_OnDocumentsDropped_ParamsSpec.$,
      null,
      [
        files
      ],
      false
    );
  }
  onTabsChanged(tabs, activeTabId) {
    this.proxy.sendMessage(
      2124763888,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      [
        tabs,
        activeTabId
      ],
      false
    );
  }
  onTabNavigationStateChanged(info) {
    this.proxy.sendMessage(
      859980247,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      [
        info
      ],
      false
    );
  }
  onTabClosed(tabId) {
    this.proxy.sendMessage(
      1044292798,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      [
        tabId
      ],
      false
    );
  }
  onFindResult(tabId, activeMatch, totalMatches) {
    this.proxy.sendMessage(
      1394744468,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      [
        tabId,
        activeMatch,
        totalMatches
      ],
      false
    );
  }
  onCommand(command) {
    this.proxy.sendMessage(
      138491081,
      ShellClient_OnCommand_ParamsSpec.$,
      null,
      [
        command
      ],
      false
    );
  }
};
var ShellClientReceiver = class {
  helper_internal_;
  $;
  onConnectionError;
  constructor(impl) {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.helper_internal_.registerHandler(
      1435046940,
      ShellClient_OnDocumentsDropped_ParamsSpec.$,
      null,
      impl.onDocumentsDropped.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      2124763888,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      impl.onTabsChanged.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      859980247,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      impl.onTabNavigationStateChanged.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1044292798,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      impl.onTabClosed.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      1394744468,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      impl.onFindResult.bind(impl),
      false
    );
    this.helper_internal_.registerHandler(
      138491081,
      ShellClient_OnCommand_ParamsSpec.$,
      null,
      impl.onCommand.bind(impl),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
};
var ShellClient = class {
  static get $interfaceName() {
    return "webdeck.mojom.ShellClient";
  }
  /**
   * Returns a remote for this interface which sends messages to the browser.
   * The browser must have an interface request binder registered for this
   * interface and accessible to the calling document's frame.
   */
  static getRemote() {
    let remote = new ShellClientRemote();
    remote.$.bindNewPipeAndPassReceiver().bindInBrowser();
    return remote;
  }
};
var ShellClientCallbackRouter = class {
  helper_internal_;
  $;
  router_;
  onDocumentsDropped;
  onTabsChanged;
  onTabNavigationStateChanged;
  onTabClosed;
  onFindResult;
  onCommand;
  onConnectionError;
  constructor() {
    this.helper_internal_ = new mojo.internal.interfaceSupport.InterfaceReceiverHelperInternal(
      ShellClientRemote
    );
    this.$ = new mojo.internal.interfaceSupport.InterfaceReceiverHelper(this.helper_internal_);
    this.router_ = new mojo.internal.interfaceSupport.CallbackRouter();
    this.onDocumentsDropped = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1435046940,
      ShellClient_OnDocumentsDropped_ParamsSpec.$,
      null,
      this.onDocumentsDropped.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onTabsChanged = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      2124763888,
      ShellClient_OnTabsChanged_ParamsSpec.$,
      null,
      this.onTabsChanged.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onTabNavigationStateChanged = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      859980247,
      ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
      null,
      this.onTabNavigationStateChanged.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onTabClosed = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1044292798,
      ShellClient_OnTabClosed_ParamsSpec.$,
      null,
      this.onTabClosed.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onFindResult = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      1394744468,
      ShellClient_OnFindResult_ParamsSpec.$,
      null,
      this.onFindResult.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onCommand = new mojo.internal.interfaceSupport.InterfaceCallbackReceiver(
      this.router_
    );
    this.helper_internal_.registerHandler(
      138491081,
      ShellClient_OnCommand_ParamsSpec.$,
      null,
      this.onCommand.createReceiverHandler(
        false
        /* expectsResponse */
      ),
      false
    );
    this.onConnectionError = this.helper_internal_.getConnectionErrorEventRouter();
  }
  /**
   * @param id An ID returned by a prior call to addListener.
   * @return True iff the identified listener was found and removed.
   */
  removeListener(id) {
    return this.router_.removeListener(id);
  }
};
var SignedFileSpec = { $: {} };
var LocalFileOpenedSpec = { $: {} };
var SettingPrefSpec = { $: {} };
var ExtensionActionInfoSpec = { $: {} };
var SignInInfoSpec = { $: {} };
var TabInfoSpec = { $: {} };
var AgentTabs_OpenTab_ParamsSpec = { $: {} };
var AgentTabs_OpenTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SendCommand_ParamsSpec = { $: {} };
var AgentTabs_SendCommand_ResponseParamsSpec = { $: {} };
var AgentTabs_CloseTab_ParamsSpec = { $: {} };
var AgentTabs_CloseTab_ResponseParamsSpec = { $: {} };
var AgentTabs_SetClient_ParamsSpec = { $: {} };
var AgentTabsClient_OnEvent_ParamsSpec = { $: {} };
var AgentTabsClient_OnDetached_ParamsSpec = { $: {} };
var Shell_SetStageBounds_ParamsSpec = { $: {} };
var Shell_SetSplit_ParamsSpec = { $: {} };
var Shell_SetSecondaryStageBounds_ParamsSpec = { $: {} };
var Shell_CreateTab_ParamsSpec = { $: {} };
var Shell_CreateTab_ResponseParamsSpec = { $: {} };
var Shell_SelectTab_ParamsSpec = { $: {} };
var Shell_CloseTab_ParamsSpec = { $: {} };
var Shell_Navigate_ParamsSpec = { $: {} };
var Shell_Reload_ParamsSpec = { $: {} };
var Shell_ReloadShell_ParamsSpec = { $: {} };
var Shell_GoBack_ParamsSpec = { $: {} };
var Shell_GoForward_ParamsSpec = { $: {} };
var Shell_Stop_ParamsSpec = { $: {} };
var Shell_SetStageCornerRadius_ParamsSpec = { $: {} };
var Shell_Find_ParamsSpec = { $: {} };
var Shell_StopFind_ParamsSpec = { $: {} };
var Shell_SetZoom_ParamsSpec = { $: {} };
var Shell_SetZoom_ResponseParamsSpec = { $: {} };
var Shell_Print_ParamsSpec = { $: {} };
var Shell_OpenDevTools_ParamsSpec = { $: {} };
var Shell_TogglePictureInPicture_ParamsSpec = { $: {} };
var Shell_GetPageText_ParamsSpec = { $: {} };
var Shell_GetPageText_ResponseParamsSpec = { $: {} };
var Shell_GetBlockThirdPartyCookies_ParamsSpec = { $: {} };
var Shell_GetBlockThirdPartyCookies_ResponseParamsSpec = { $: {} };
var Shell_SetBlockThirdPartyCookies_ParamsSpec = { $: {} };
var Shell_GetSendDoNotTrack_ParamsSpec = { $: {} };
var Shell_GetSendDoNotTrack_ResponseParamsSpec = { $: {} };
var Shell_SetSendDoNotTrack_ParamsSpec = { $: {} };
var Shell_GetHttpsOnlyMode_ParamsSpec = { $: {} };
var Shell_GetHttpsOnlyMode_ResponseParamsSpec = { $: {} };
var Shell_SetHttpsOnlyMode_ParamsSpec = { $: {} };
var Shell_GetPreloadPages_ParamsSpec = { $: {} };
var Shell_GetPreloadPages_ResponseParamsSpec = { $: {} };
var Shell_SetPreloadPages_ParamsSpec = { $: {} };
var Shell_GetAdblockEnabled_ParamsSpec = { $: {} };
var Shell_GetAdblockEnabled_ResponseParamsSpec = { $: {} };
var Shell_SetAdblockEnabled_ParamsSpec = { $: {} };
var Shell_GetAdblockBlockedCount_ParamsSpec = { $: {} };
var Shell_GetAdblockBlockedCount_ResponseParamsSpec = { $: {} };
var Shell_ClearBrowsingData_ParamsSpec = { $: {} };
var Shell_ClearBrowsingData_ResponseParamsSpec = { $: {} };
var Shell_GetDefaultBrowserState_ParamsSpec = { $: {} };
var Shell_GetDefaultBrowserState_ResponseParamsSpec = { $: {} };
var Shell_SetAsDefaultBrowser_ParamsSpec = { $: {} };
var Shell_SetAsDefaultBrowser_ResponseParamsSpec = { $: {} };
var Shell_GetExtensionActions_ParamsSpec = { $: {} };
var Shell_GetExtensionActions_ResponseParamsSpec = { $: {} };
var Shell_RunExtensionAction_ParamsSpec = { $: {} };
var Shell_RunExtensionAction_ResponseParamsSpec = { $: {} };
var Shell_GetSettingPrefs_ParamsSpec = { $: {} };
var Shell_GetSettingPrefs_ResponseParamsSpec = { $: {} };
var Shell_SetSettingPref_ParamsSpec = { $: {} };
var Shell_SetSettingPref_ResponseParamsSpec = { $: {} };
var Shell_GetAccountInfo_ParamsSpec = { $: {} };
var Shell_GetAccountInfo_ResponseParamsSpec = { $: {} };
var Shell_SetClient_ParamsSpec = { $: {} };
var Shell_SetStageVisible_ParamsSpec = { $: {} };
var Shell_CaptureStage_ParamsSpec = { $: {} };
var Shell_CaptureStage_ResponseParamsSpec = { $: {} };
var Shell_OpenWindow_ParamsSpec = { $: {} };
var Shell_OpenWindow_ResponseParamsSpec = { $: {} };
var Shell_FocusWindow_ParamsSpec = { $: {} };
var Shell_CloseWindow_ParamsSpec = { $: {} };
var Shell_PickPaths_ParamsSpec = { $: {} };
var Shell_PickPaths_ResponseParamsSpec = { $: {} };
var Shell_PickImage_ParamsSpec = { $: {} };
var Shell_PickImage_ResponseParamsSpec = { $: {} };
var Shell_OpenLocalFile_ParamsSpec = { $: {} };
var Shell_OpenLocalFile_ResponseParamsSpec = { $: {} };
var ShellClient_OnDocumentsDropped_ParamsSpec = { $: {} };
var ShellClient_OnTabsChanged_ParamsSpec = { $: {} };
var ShellClient_OnTabNavigationStateChanged_ParamsSpec = { $: {} };
var ShellClient_OnTabClosed_ParamsSpec = { $: {} };
var ShellClient_OnFindResult_ParamsSpec = { $: {} };
var ShellClient_OnCommand_ParamsSpec = { $: {} };
mojo.internal.Struct(
  SignedFileSpec.$,
  "SignedFile",
  [
    mojo.internal.StructField(
      "path",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "auth",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  LocalFileOpenedSpec.$,
  "LocalFileOpened",
  [
    mojo.internal.StructField(
      "navigated",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "document",
      8,
      0,
      SignedFileSpec.$,
      null,
      true,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  SettingPrefSpec.$,
  "SettingPref",
  [
    mojo.internal.StructField(
      "name",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "jsonValue",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "managed",
      16,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "unavailable",
      16,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  ExtensionActionInfoSpec.$,
  "ExtensionActionInfo",
  [
    mojo.internal.StructField(
      "id",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "name",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "title",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "badgeText",
      24,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "enabled",
      32,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "hasPopup",
      32,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 48]]
);
mojo.internal.Struct(
  SignInInfoSpec.$,
  "SignInInfo",
  [
    mojo.internal.StructField(
      "signedIn",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "email",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "fullName",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "avatarDataUrl",
      24,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "profileName",
      32,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "signinSupported",
      0,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 48]]
);
mojo.internal.Struct(
  TabInfoSpec.$,
  "TabInfo",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "url",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "title",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "canGoBack",
      4,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "canGoForward",
      4,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "isLoading",
      4,
      2,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabs_OpenTab_ParamsSpec.$,
  "AgentTabs_OpenTab_Params",
  [
    mojo.internal.StructField(
      "url",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabs_OpenTab_ResponseParamsSpec.$,
  "AgentTabs_OpenTab_ResponseParams",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "error",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  AgentTabs_SendCommand_ParamsSpec.$,
  "AgentTabs_SendCommand_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "method",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "paramsJson",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabs_SendCommand_ResponseParamsSpec.$,
  "AgentTabs_SendCommand_ResponseParams",
  [
    mojo.internal.StructField(
      "resultJson",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "error",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  AgentTabs_CloseTab_ParamsSpec.$,
  "AgentTabs_CloseTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabs_CloseTab_ResponseParamsSpec.$,
  "AgentTabs_CloseTab_ResponseParams",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  AgentTabs_SetClient_ParamsSpec.$,
  "AgentTabs_SetClient_Params",
  [
    mojo.internal.StructField(
      "client",
      0,
      0,
      mojo.internal.InterfaceProxy(AgentTabsClientRemote),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  AgentTabsClient_OnEvent_ParamsSpec.$,
  "AgentTabsClient_OnEvent_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "method",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "paramsJson",
      16,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 32]]
);
mojo.internal.Struct(
  AgentTabsClient_OnDetached_ParamsSpec.$,
  "AgentTabsClient_OnDetached_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetStageBounds_ParamsSpec.$,
  "Shell_SetStageBounds_Params",
  [
    mojo.internal.StructField(
      "stage",
      0,
      0,
      gfx_mojom_RectSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetSplit_ParamsSpec.$,
  "Shell_SetSplit_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "primaryTabId",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "secondaryTabId",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_SetSecondaryStageBounds_ParamsSpec.$,
  "Shell_SetSecondaryStageBounds_Params",
  [
    mojo.internal.StructField(
      "stage",
      0,
      0,
      gfx_mojom_RectSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CreateTab_ParamsSpec.$,
  "Shell_CreateTab_Params",
  [
    mojo.internal.StructField(
      "url",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CreateTab_ResponseParamsSpec.$,
  "Shell_CreateTab_ResponseParams",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SelectTab_ParamsSpec.$,
  "Shell_SelectTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CloseTab_ParamsSpec.$,
  "Shell_CloseTab_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Navigate_ParamsSpec.$,
  "Shell_Navigate_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "url",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_Reload_ParamsSpec.$,
  "Shell_Reload_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_ReloadShell_ParamsSpec.$,
  "Shell_ReloadShell_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GoBack_ParamsSpec.$,
  "Shell_GoBack_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GoForward_ParamsSpec.$,
  "Shell_GoForward_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Stop_ParamsSpec.$,
  "Shell_Stop_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetStageCornerRadius_ParamsSpec.$,
  "Shell_SetStageCornerRadius_Params",
  [
    mojo.internal.StructField(
      "radius",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Find_ParamsSpec.$,
  "Shell_Find_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "query",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "forward",
      4,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_StopFind_ParamsSpec.$,
  "Shell_StopFind_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetZoom_ParamsSpec.$,
  "Shell_SetZoom_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "level",
      8,
      0,
      mojo.internal.Double,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_SetZoom_ResponseParamsSpec.$,
  "Shell_SetZoom_ResponseParams",
  [
    mojo.internal.StructField(
      "applied",
      0,
      0,
      mojo.internal.Double,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_Print_ParamsSpec.$,
  "Shell_Print_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenDevTools_ParamsSpec.$,
  "Shell_OpenDevTools_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_TogglePictureInPicture_ParamsSpec.$,
  "Shell_TogglePictureInPicture_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPageText_ParamsSpec.$,
  "Shell_GetPageText_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPageText_ResponseParamsSpec.$,
  "Shell_GetPageText_ResponseParams",
  [
    mojo.internal.StructField(
      "text",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetBlockThirdPartyCookies_ParamsSpec.$,
  "Shell_GetBlockThirdPartyCookies_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetBlockThirdPartyCookies_ResponseParamsSpec.$,
  "Shell_GetBlockThirdPartyCookies_ResponseParams",
  [
    mojo.internal.StructField(
      "blocked",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetBlockThirdPartyCookies_ParamsSpec.$,
  "Shell_SetBlockThirdPartyCookies_Params",
  [
    mojo.internal.StructField(
      "blocked",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetSendDoNotTrack_ParamsSpec.$,
  "Shell_GetSendDoNotTrack_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetSendDoNotTrack_ResponseParamsSpec.$,
  "Shell_GetSendDoNotTrack_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetSendDoNotTrack_ParamsSpec.$,
  "Shell_SetSendDoNotTrack_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetHttpsOnlyMode_ParamsSpec.$,
  "Shell_GetHttpsOnlyMode_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetHttpsOnlyMode_ResponseParamsSpec.$,
  "Shell_GetHttpsOnlyMode_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetHttpsOnlyMode_ParamsSpec.$,
  "Shell_SetHttpsOnlyMode_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetPreloadPages_ParamsSpec.$,
  "Shell_GetPreloadPages_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetPreloadPages_ResponseParamsSpec.$,
  "Shell_GetPreloadPages_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetPreloadPages_ParamsSpec.$,
  "Shell_SetPreloadPages_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetAdblockEnabled_ParamsSpec.$,
  "Shell_GetAdblockEnabled_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetAdblockEnabled_ResponseParamsSpec.$,
  "Shell_GetAdblockEnabled_ResponseParams",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetAdblockEnabled_ParamsSpec.$,
  "Shell_SetAdblockEnabled_Params",
  [
    mojo.internal.StructField(
      "enabled",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetAdblockBlockedCount_ParamsSpec.$,
  "Shell_GetAdblockBlockedCount_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetAdblockBlockedCount_ResponseParamsSpec.$,
  "Shell_GetAdblockBlockedCount_ResponseParams",
  [
    mojo.internal.StructField(
      "count",
      0,
      0,
      mojo.internal.Uint64,
      BigInt(0),
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_ClearBrowsingData_ParamsSpec.$,
  "Shell_ClearBrowsingData_Params",
  [
    mojo.internal.StructField(
      "cookies",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "cache",
      0,
      1,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "history",
      0,
      2,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "timeRange",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_ClearBrowsingData_ResponseParamsSpec.$,
  "Shell_ClearBrowsingData_ResponseParams",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetDefaultBrowserState_ParamsSpec.$,
  "Shell_GetDefaultBrowserState_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetDefaultBrowserState_ResponseParamsSpec.$,
  "Shell_GetDefaultBrowserState_ResponseParams",
  [
    mojo.internal.StructField(
      "state",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetAsDefaultBrowser_ParamsSpec.$,
  "Shell_SetAsDefaultBrowser_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_SetAsDefaultBrowser_ResponseParamsSpec.$,
  "Shell_SetAsDefaultBrowser_ResponseParams",
  [
    mojo.internal.StructField(
      "state",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetExtensionActions_ParamsSpec.$,
  "Shell_GetExtensionActions_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetExtensionActions_ResponseParamsSpec.$,
  "Shell_GetExtensionActions_ResponseParams",
  [
    mojo.internal.StructField(
      "actions",
      0,
      0,
      mojo.internal.Array(ExtensionActionInfoSpec.$, false),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_RunExtensionAction_ParamsSpec.$,
  "Shell_RunExtensionAction_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "extensionId",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_RunExtensionAction_ResponseParamsSpec.$,
  "Shell_RunExtensionAction_ResponseParams",
  [
    mojo.internal.StructField(
      "showedPopup",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetSettingPrefs_ParamsSpec.$,
  "Shell_GetSettingPrefs_Params",
  [
    mojo.internal.StructField(
      "names",
      0,
      0,
      mojo.internal.Array(mojo.internal.String, false),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetSettingPrefs_ResponseParamsSpec.$,
  "Shell_GetSettingPrefs_ResponseParams",
  [
    mojo.internal.StructField(
      "prefs",
      0,
      0,
      mojo.internal.Array(SettingPrefSpec.$, false),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetSettingPref_ParamsSpec.$,
  "Shell_SetSettingPref_Params",
  [
    mojo.internal.StructField(
      "name",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "jsonValue",
      8,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  Shell_SetSettingPref_ResponseParamsSpec.$,
  "Shell_SetSettingPref_ResponseParams",
  [
    mojo.internal.StructField(
      "ok",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_GetAccountInfo_ParamsSpec.$,
  "Shell_GetAccountInfo_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_GetAccountInfo_ResponseParamsSpec.$,
  "Shell_GetAccountInfo_ResponseParams",
  [
    mojo.internal.StructField(
      "info",
      0,
      0,
      SignInInfoSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetClient_ParamsSpec.$,
  "Shell_SetClient_Params",
  [
    mojo.internal.StructField(
      "client",
      0,
      0,
      mojo.internal.InterfaceProxy(ShellClientRemote),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_SetStageVisible_ParamsSpec.$,
  "Shell_SetStageVisible_Params",
  [
    mojo.internal.StructField(
      "visible",
      0,
      0,
      mojo.internal.Bool,
      false,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CaptureStage_ParamsSpec.$,
  "Shell_CaptureStage_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CaptureStage_ResponseParamsSpec.$,
  "Shell_CaptureStage_ResponseParams",
  [
    mojo.internal.StructField(
      "dataUrl",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenWindow_ParamsSpec.$,
  "Shell_OpenWindow_Params",
  [
    mojo.internal.StructField(
      "url",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenWindow_ResponseParamsSpec.$,
  "Shell_OpenWindow_ResponseParams",
  [
    mojo.internal.StructField(
      "windowId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_FocusWindow_ParamsSpec.$,
  "Shell_FocusWindow_Params",
  [
    mojo.internal.StructField(
      "windowId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_CloseWindow_ParamsSpec.$,
  "Shell_CloseWindow_Params",
  [
    mojo.internal.StructField(
      "windowId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_PickPaths_ParamsSpec.$,
  "Shell_PickPaths_Params",
  [
    mojo.internal.StructField(
      "mode",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_PickPaths_ResponseParamsSpec.$,
  "Shell_PickPaths_ResponseParams",
  [
    mojo.internal.StructField(
      "paths",
      0,
      0,
      mojo.internal.Array(mojo.internal.String, false),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_PickImage_ParamsSpec.$,
  "Shell_PickImage_Params",
  [],
  [[0, 8]]
);
mojo.internal.Struct(
  Shell_PickImage_ResponseParamsSpec.$,
  "Shell_PickImage_ResponseParams",
  [
    mojo.internal.StructField(
      "dataUrl",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenLocalFile_ParamsSpec.$,
  "Shell_OpenLocalFile_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  Shell_OpenLocalFile_ResponseParamsSpec.$,
  "Shell_OpenLocalFile_ResponseParams",
  [
    mojo.internal.StructField(
      "result",
      0,
      0,
      LocalFileOpenedSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnDocumentsDropped_ParamsSpec.$,
  "ShellClient_OnDocumentsDropped_Params",
  [
    mojo.internal.StructField(
      "files",
      0,
      0,
      mojo.internal.Array(SignedFileSpec.$, false),
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnTabsChanged_ParamsSpec.$,
  "ShellClient_OnTabsChanged_Params",
  [
    mojo.internal.StructField(
      "tabs",
      0,
      0,
      mojo.internal.Array(TabInfoSpec.$, false),
      null,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "activeTabId",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  ShellClient_OnTabNavigationStateChanged_ParamsSpec.$,
  "ShellClient_OnTabNavigationStateChanged_Params",
  [
    mojo.internal.StructField(
      "info",
      0,
      0,
      TabInfoSpec.$,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnTabClosed_ParamsSpec.$,
  "ShellClient_OnTabClosed_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
mojo.internal.Struct(
  ShellClient_OnFindResult_ParamsSpec.$,
  "ShellClient_OnFindResult_Params",
  [
    mojo.internal.StructField(
      "tabId",
      0,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "activeMatch",
      4,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    ),
    mojo.internal.StructField(
      "totalMatches",
      8,
      0,
      mojo.internal.Int32,
      0,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 24]]
);
mojo.internal.Struct(
  ShellClient_OnCommand_ParamsSpec.$,
  "ShellClient_OnCommand_Params",
  [
    mojo.internal.StructField(
      "command",
      0,
      0,
      mojo.internal.String,
      null,
      false,
      0,
      void 0,
      void 0
    )
  ],
  [[0, 16]]
);
export {
  AgentTabs,
  AgentTabsCallbackRouter,
  AgentTabsClient,
  AgentTabsClientCallbackRouter,
  AgentTabsClientPendingReceiver,
  AgentTabsClientReceiver,
  AgentTabsClientRemote,
  AgentTabsClient_OnDetached_ParamsSpec,
  AgentTabsClient_OnEvent_ParamsSpec,
  AgentTabsPendingReceiver,
  AgentTabsReceiver,
  AgentTabsRemote,
  AgentTabs_CloseTab_ParamsSpec,
  AgentTabs_CloseTab_ResponseParamsSpec,
  AgentTabs_OpenTab_ParamsSpec,
  AgentTabs_OpenTab_ResponseParamsSpec,
  AgentTabs_SendCommand_ParamsSpec,
  AgentTabs_SendCommand_ResponseParamsSpec,
  AgentTabs_SetClient_ParamsSpec,
  ExtensionActionInfoSpec,
  LocalFileOpenedSpec,
  SettingPrefSpec,
  Shell,
  ShellCallbackRouter,
  ShellClient,
  ShellClientCallbackRouter,
  ShellClientPendingReceiver,
  ShellClientReceiver,
  ShellClientRemote,
  ShellClient_OnCommand_ParamsSpec,
  ShellClient_OnDocumentsDropped_ParamsSpec,
  ShellClient_OnFindResult_ParamsSpec,
  ShellClient_OnTabClosed_ParamsSpec,
  ShellClient_OnTabNavigationStateChanged_ParamsSpec,
  ShellClient_OnTabsChanged_ParamsSpec,
  ShellPendingReceiver,
  ShellReceiver,
  ShellRemote,
  Shell_CaptureStage_ParamsSpec,
  Shell_CaptureStage_ResponseParamsSpec,
  Shell_ClearBrowsingData_ParamsSpec,
  Shell_ClearBrowsingData_ResponseParamsSpec,
  Shell_CloseTab_ParamsSpec,
  Shell_CloseWindow_ParamsSpec,
  Shell_CreateTab_ParamsSpec,
  Shell_CreateTab_ResponseParamsSpec,
  Shell_Find_ParamsSpec,
  Shell_FocusWindow_ParamsSpec,
  Shell_GetAccountInfo_ParamsSpec,
  Shell_GetAccountInfo_ResponseParamsSpec,
  Shell_GetAdblockBlockedCount_ParamsSpec,
  Shell_GetAdblockBlockedCount_ResponseParamsSpec,
  Shell_GetAdblockEnabled_ParamsSpec,
  Shell_GetAdblockEnabled_ResponseParamsSpec,
  Shell_GetBlockThirdPartyCookies_ParamsSpec,
  Shell_GetBlockThirdPartyCookies_ResponseParamsSpec,
  Shell_GetDefaultBrowserState_ParamsSpec,
  Shell_GetDefaultBrowserState_ResponseParamsSpec,
  Shell_GetExtensionActions_ParamsSpec,
  Shell_GetExtensionActions_ResponseParamsSpec,
  Shell_GetHttpsOnlyMode_ParamsSpec,
  Shell_GetHttpsOnlyMode_ResponseParamsSpec,
  Shell_GetPageText_ParamsSpec,
  Shell_GetPageText_ResponseParamsSpec,
  Shell_GetPreloadPages_ParamsSpec,
  Shell_GetPreloadPages_ResponseParamsSpec,
  Shell_GetSendDoNotTrack_ParamsSpec,
  Shell_GetSendDoNotTrack_ResponseParamsSpec,
  Shell_GetSettingPrefs_ParamsSpec,
  Shell_GetSettingPrefs_ResponseParamsSpec,
  Shell_GoBack_ParamsSpec,
  Shell_GoForward_ParamsSpec,
  Shell_Navigate_ParamsSpec,
  Shell_OpenDevTools_ParamsSpec,
  Shell_OpenLocalFile_ParamsSpec,
  Shell_OpenLocalFile_ResponseParamsSpec,
  Shell_OpenWindow_ParamsSpec,
  Shell_OpenWindow_ResponseParamsSpec,
  Shell_PickImage_ParamsSpec,
  Shell_PickImage_ResponseParamsSpec,
  Shell_PickPaths_ParamsSpec,
  Shell_PickPaths_ResponseParamsSpec,
  Shell_Print_ParamsSpec,
  Shell_ReloadShell_ParamsSpec,
  Shell_Reload_ParamsSpec,
  Shell_RunExtensionAction_ParamsSpec,
  Shell_RunExtensionAction_ResponseParamsSpec,
  Shell_SelectTab_ParamsSpec,
  Shell_SetAdblockEnabled_ParamsSpec,
  Shell_SetAsDefaultBrowser_ParamsSpec,
  Shell_SetAsDefaultBrowser_ResponseParamsSpec,
  Shell_SetBlockThirdPartyCookies_ParamsSpec,
  Shell_SetClient_ParamsSpec,
  Shell_SetHttpsOnlyMode_ParamsSpec,
  Shell_SetPreloadPages_ParamsSpec,
  Shell_SetSecondaryStageBounds_ParamsSpec,
  Shell_SetSendDoNotTrack_ParamsSpec,
  Shell_SetSettingPref_ParamsSpec,
  Shell_SetSettingPref_ResponseParamsSpec,
  Shell_SetSplit_ParamsSpec,
  Shell_SetStageBounds_ParamsSpec,
  Shell_SetStageCornerRadius_ParamsSpec,
  Shell_SetStageVisible_ParamsSpec,
  Shell_SetZoom_ParamsSpec,
  Shell_SetZoom_ResponseParamsSpec,
  Shell_StopFind_ParamsSpec,
  Shell_Stop_ParamsSpec,
  Shell_TogglePictureInPicture_ParamsSpec,
  SignInInfoSpec,
  SignedFileSpec,
  TabInfoSpec
};
