// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/ui/webui/webdeck/webdeck_shell.h"

#include "chrome/browser/ui/webui/webdeck/webdeck_adblock.h"

#include <algorithm>
#include <utility>

#include <vector>

#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "chrome/app/chrome_command_ids.h"
#include "base/notimplemented.h"
#include "base/files/file_util.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "base/task/bind_post_task.h"
#include "base/task/sequenced_task_runner.h"
#include "base/unguessable_token.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/values.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_dock_side.h"
#include "chrome/browser/devtools/devtools_toggle_action.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/preloading/preloading_prefs.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/shell_integration.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/webdeck/webdeck_core_service.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/contents_container_view.h"
#include "chrome/browser/webdeck/webdeck_shell_host.h"
#include "base/base64.h"
#include "google_apis/google_api_keys.h"
#include "net/base/filename_util.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "extensions/browser/extension_action_manager.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "chrome/browser/browser_process.h"
#include "components/prefs/pref_service.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/signin/identity_manager_factory.h"
#include "chrome/browser/ui/toolbar/toolbar_actions_model.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/signin/public/identity_manager/account_info.h"
#include "components/signin/public/identity_manager/identity_manager.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "ui/gfx/image/image.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/render_widget_host_view.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/codec/jpeg_codec.h"
#include "ui/gfx/geometry/size_conversions.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/common/pref_names.h"
#include "chrome/common/webui_url_constants.h"
#include "components/sessions/core/session_id.h"
#include "ui/base/base_window.h"
#include "components/content_settings/core/browser/cookie_settings.h"
#include "components/content_settings/core/common/pref_names.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "components/prefs/pref_service.h"
#include "components/tabs/public/tab_interface.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/browsing_data_remover.h"
#include "content/public/browser/media_session.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/referrer.h"
#include "content/public/common/url_constants.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "services/media_session/public/mojom/media_session.mojom.h"
#include "ui/base/page_transition_types.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "url/gurl.h"
#include "url/url_constants.h"

namespace webdeck {

namespace {

// The schemes the shell may point the window's real tab at. Deliberately the
// same conservative bar as AgentTabs (webdeck_agent_tabs.cc IsAllowedScheme):
// http/https only, so a compromised chrome://webdeck renderer cannot silently
// drive the user's visible tab to file:// (local file disclosure), chrome:// /
// chrome-untrusted:// / devtools:// (privileged surfaces), or
// javascript:/blob:/filesystem: — and a WebDeck window has no native omnibox to
// warn the user. The two explicit internal exceptions are about:blank (the
// blank staged / new tab) and chrome://webdeck itself. Reaching other internal
// pages needs a policy-gated trust path (see SHELL_ARCHITECTURE.md); it is
// intentionally not this interface.
bool IsAllowedShellUrl(const GURL& url) {
  if (url.SchemeIs(url::kHttpScheme) || url.SchemeIs(url::kHttpsScheme)) {
    return true;
  }
  if (url.IsAboutBlank()) {
    return true;
  }
  if (!url.SchemeIs(content::kChromeUIScheme)) {
    return false;
  }
  // chrome://webdeck itself, plus the pages a person reaches from a browser's
  // own menus — profiles and sign-in live at chrome://settings/people, and
  // Chromium owns extensions, history, downloads and bookmarks on this build.
  // Still no chrome://flags, chrome://policy or other privileged surfaces.
  static constexpr const char* kAllowedHosts[] = {
      chrome::kChromeUIWebDeckHost,
      "settings",
      // Saved passwords live here: chrome://settings/passwords is a redirect
      // to chrome://password-manager, so refusing this host meant the
      // password manager could be opened and then instantly dead-ended.
      "password-manager",
      "extensions",
      "history",
      "downloads",
      "bookmarks",
      "newtab",
      "version"};
  for (const char* host : kAllowedHosts) {
    if (url.host() == host) {
      return true;
    }
  }
  return false;
}

// Collapse the four-way DefaultWebClientState into the shell's 3-state code:
// 0 = not default, 1 = default, 2 = unknown/error. OTHER_MODE_IS_DEFAULT means
// another install mode of this brand is default, i.e. THIS one is not — report
// "not default" so the "Make default" button stays actionable.
int32_t DefaultBrowserStateCode(shell_integration::DefaultWebClientState state) {
  switch (state) {
    case shell_integration::IS_DEFAULT:
      return 1;
    case shell_integration::NOT_DEFAULT:
    case shell_integration::OTHER_MODE_IS_DEFAULT:
      return 0;
    case shell_integration::UNKNOWN_DEFAULT:
    case shell_integration::NUM_DEFAULT_STATES:
      return 2;
  }
  return 2;
}

// Cap the returned page text so a huge page can neither blow up the Mojo
// message nor swamp the assistant's context. The head is kept — a page's title,
// headings and lead paragraphs are at the top, which is what a summary/Q&A
// grounds on.
constexpr size_t kMaxPageTextChars = 100000;

// Turn the isolated-world eval result (a base::Value) into the capped string the
// GetPageText reply carries. innerText yields a JS string; anything else (the
// frame refused, returned undefined) collapses to empty.
void OnPageTextExtracted(mojom::Shell::GetPageTextCallback callback,
                         base::Value value) {
  std::string text = value.is_string() ? value.GetString() : std::string();
  if (text.size() > kMaxPageTextChars) {
    text.resize(kMaxPageTextChars);
  }
  std::move(callback).Run(text);
}

// The still the shell shows in place of a hidden stage (CaptureStage). JPEG,
// not PNG: a page-sized bitmap at 2x encodes in a few tens of milliseconds as
// JPEG and several times longer as PNG, and the still is on screen only for as
// long as a menu is open. 90 keeps text crisp.
constexpr int kStageStillJpegQuality = 90;

// Runs on the thread pool: the still as a data: URL, or "" when the copy drew
// nothing. Encoding stays off the UI thread so a menu never stalls the window.
std::string EncodeStageStill(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing()) {
    return std::string();
  }
  std::optional<std::vector<uint8_t>> jpeg =
      gfx::JPEGCodec::Encode(bitmap, kStageStillJpegQuality);
  if (!jpeg) {
    return std::string();
  }
  return "data:image/jpeg;base64," + base::Base64Encode(*jpeg);
}

void OnStageCopied(mojom::Shell::CaptureStageCallback callback,
                   const content::CopyFromSurfaceResult& result) {
  if (!result.has_value()) {
    std::move(callback).Run(std::string());
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::TaskPriority::USER_BLOCKING},
      base::BindOnce(&EncodeStageStill, result->bitmap), std::move(callback));
}

}  // namespace

WebDeckShell::WebDeckShell(content::WebContents* shell_contents,
                           mojo::PendingReceiver<mojom::Shell> receiver)
    : shell_contents_(shell_contents),
      receiver_(this, std::move(receiver)) {}

WebDeckShell::~WebDeckShell() {
  if (forwarding_window_) {
    webdeck::ClearFilesDropForwarder(forwarding_window_);
    webdeck::ClearCommandForwarder(forwarding_window_);
    forwarding_window_ = nullptr;
  }
  if (select_file_dialog_) {
    // The panel outlives us on the native side; it must not call back.
    select_file_dialog_->ListenerDestroyed();
    select_file_dialog_ = nullptr;
  }
  if (observed_model_) {
    observed_model_->RemoveObserver(this);
  }
  if (observed_find_helper_) {
    observed_find_helper_->RemoveObserver(this);
    observed_find_helper_ = nullptr;
  }
}

BrowserWindowInterface* WebDeckShell::GetWindow() {
  WebDeckShellHost* host = WebDeckShellHost::FromWebContents(shell_contents_);
  return host ? host->window() : nullptr;
}

ContentsContainerView* WebDeckShell::GetContentsContainerView() {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return nullptr;
  }
  BrowserView* view = BrowserView::GetBrowserViewForBrowser(window);
  return view ? view->GetActiveContentsContainerView() : nullptr;
}

content::WebContents* WebDeckShell::GetTabById(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return nullptr;
  }
  // tab_id 0 addresses the active tab. The shell owns tab identity as its own
  // string ids and drives the single staged (active) tab, so the renderer maps
  // its per-id operations onto the active tab; a real handle still addresses a
  // specific tab (multi-tab switching, later).
  if (tab_id == 0) {
    return window->GetTabStripModel()->GetActiveWebContents();
  }
  tabs::TabInterface* tab = tabs::TabHandle(tab_id).Get();
  if (!tab) {
    return nullptr;
  }
  content::WebContents* contents = tab->GetContents();
  if (!contents ||
      window->GetTabStripModel()->GetIndexOfWebContents(contents) < 0) {
    // The tab is gone or belongs to another window — do not act on it.
    return nullptr;
  }
  return contents;
}

Profile* WebDeckShell::GetProfile() {
  return Profile::FromBrowserContext(shell_contents_->GetBrowserContext());
}

void WebDeckShell::SetStageBounds(const gfx::Rect& stage) {
  // The DevTools resizing strategy: the "devtools" view (here, the shell) gets
  // the whole container, the "contents" view (the active tab) gets `stage`.
  // kNone means no min-size clamping — honor the shell's rect exactly.
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetContentsResizingStrategy(
        DevToolsContentsResizingStrategy(devtools::DockSide::kNone, stage));
  }
}

void WebDeckShell::SetSplit(bool enabled,
                            int32_t primary_tab_id,
                            int32_t secondary_tab_id) {
  if (!enabled) {
    // Tear the split down. `primary_tab_id`/`secondary_tab_id` are not addressed
    // on disable, so no tab lookup is done here. Forget the tracked secondary
    // tab and drop it from the container.
    secondary_tab_id_ = 0;
    if (ContentsContainerView* container = GetContentsContainerView()) {
      container->SetSecondaryStagedContents(nullptr);
    }
    return;
  }

  // Validate the addressed tabs before acting: GetTabById maps 0 -> active tab
  // and rejects a handle that is gone or belongs to another window, so a
  // compromised chrome://webdeck cannot name a tab it does not own here (same
  // ownership gate the other tab ops use). BOTH stages must resolve to real
  // tabs in this window; otherwise refuse.
  content::WebContents* primary = GetTabById(primary_tab_id);
  content::WebContents* secondary = GetTabById(secondary_tab_id);
  if (!primary || !secondary) {
    return;
  }
  // Refuse a degenerate split (the same tab in both stages): one WebContents
  // cannot render into two ContentsWebViews at once, and the shell has nothing
  // to gain from it. Fall through to teardown semantics is wrong here — just
  // reject so the shell keeps its current (single) staging.
  if (primary == secondary) {
    return;
  }

  // Make `primary_tab_id` the primary (active) stage so the mojom contract holds
  // — the primary stage always renders the window's active tab (positioned by
  // SetStageBounds). Mirrors SelectTab's activate path; a no-op when `primary`
  // is already the active tab.
  if (BrowserWindowInterface* window = GetWindow()) {
    TabStripModel* model = window->GetTabStripModel();
    const int index = model->GetIndexOfWebContents(primary);
    if (index >= 0) {
      model->ActivateTabAt(index);
    }
  }

  // Per SPLIT_VIEW_PLAN.md (Approach A — two stages on one shell backdrop), the
  // primary ContentsContainerView owns a second staged ContentsWebView; point
  // it at the secondary tab's WebContents. The primary stage keeps flowing
  // through SetStageBounds unchanged.
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetSecondaryStagedContents(secondary);
  }

  // Track the secondary tab so its later removal can defensively tear the split
  // down (see OnTabStripModelChanged kRemoved) even if the renderer never calls
  // SetSplit(false).
  secondary_tab_id_ = 0;
  if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(secondary)) {
    secondary_tab_id_ = tab->GetHandle().raw_value();
  }
}

void WebDeckShell::SetSecondaryStageBounds(const gfx::Rect& stage) {
  // Mirror SetStageBounds for the secondary staged view: kNone means no
  // min-size clamping, so the secondary tab gets exactly `stage`. No-op unless
  // split staging is enabled (the container ignores the strategy while the
  // secondary view is hidden / has no bound contents).
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetSecondaryContentsResizingStrategy(
        DevToolsContentsResizingStrategy(devtools::DockSide::kNone, stage));
  }
}

void WebDeckShell::CreateTab(const std::string& url,
                             CreateTabCallback callback) {
  BrowserWindowInterface* window = GetWindow();
  const GURL target(url);
  if (!window || !IsAllowedShellUrl(target)) {
    // Refuse privileged/local schemes — see IsAllowedShellUrl.
    std::move(callback).Run(0);
    return;
  }
  content::WebContents* contents = chrome::AddAndReturnTabAt(
      window, target, /*index=*/-1, /*foreground=*/true);
  int32_t tab_id = 0;
  if (contents) {
    if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(contents)) {
      tab_id = tab->GetHandle().raw_value();
    }
  }
  std::move(callback).Run(tab_id);
}

void WebDeckShell::SelectTab(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(contents);
  if (index >= 0) {
    model->ActivateTabAt(index);
  }
}

void WebDeckShell::CloseTab(int32_t tab_id) {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(contents);
  if (index < 0) {
    return;
  }
  // Chromium closes a window whose last tab closes. The shell's tabs are a
  // view over this window's real tabs, and the shell owns the window — so
  // closing its last real tab (a project switch restores a layout and
  // destroys every content tab) must empty the tab, not end the window.
  // The blank tab becomes the window's seed again (shell.ts claims it on the
  // next create), which is exactly the state a fresh window starts in.
  if (model->count() == 1) {
    contents->GetController().LoadURL(GURL(url::kAboutBlankURL),
                                      content::Referrer(),
                                      ui::PAGE_TRANSITION_AUTO_TOPLEVEL,
                                      std::string());
    return;
  }
  model->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE);
}

void WebDeckShell::Navigate(int32_t tab_id, const std::string& url) {
  const GURL target(url);
  if (!IsAllowedShellUrl(target)) {
    // Refuse privileged/local schemes — see IsAllowedShellUrl. This is the main
    // vector: a compromised shell driving the staged tab to file:// / chrome://.
    return;
  }
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  contents->GetController().LoadURL(target, content::Referrer(),
                                    ui::PAGE_TRANSITION_TYPED, std::string());
}

void WebDeckShell::Reload(int32_t tab_id) {
  if (content::WebContents* contents = GetTabById(tab_id)) {
    contents->GetController().Reload(content::ReloadType::NORMAL,
                                     /*check_for_repost=*/false);
  }
}

void WebDeckShell::ReloadShell() {
  shell_contents_->GetController().Reload(content::ReloadType::NORMAL,
                                          /*check_for_repost=*/false);
}

void WebDeckShell::GoBack(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (contents && contents->GetController().CanGoBack()) {
    contents->GetController().GoBack();
  }
}

void WebDeckShell::GoForward(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (contents && contents->GetController().CanGoForward()) {
    contents->GetController().GoForward();
  }
}

void WebDeckShell::Stop(int32_t tab_id) {
  if (content::WebContents* contents = GetTabById(tab_id)) {
    contents->Stop();
  }
}

void WebDeckShell::SetStageCornerRadius(int32_t radius) {
  if (ContentsContainerView* container = GetContentsContainerView()) {
    container->SetStageCornerRadius(radius);
  }
}

void WebDeckShell::Find(int32_t tab_id,
                        const std::string& query,
                        bool forward) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // Idempotent: creates the per-tab helper if this is the first find on the tab.
  find_in_page::FindTabHelper::CreateForWebContents(contents);
  find_in_page::FindTabHelper::FromWebContents(contents)->StartFinding(
      base::UTF8ToUTF16(query), forward, /*case_sensitive=*/false,
      /*find_match=*/true);
}

void WebDeckShell::StopFind(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(contents)) {
    helper->StopFinding(find_in_page::SelectionAction::kClear);
  }
}

void WebDeckShell::SetZoom(int32_t tab_id,
                           double level,
                           SetZoomCallback callback) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    std::move(callback).Run(0);
    return;
  }
  zoom::ZoomController* controller =
      zoom::ZoomController::FromWebContents(contents);
  if (!controller) {
    std::move(callback).Run(0);
    return;
  }
  controller->SetZoomLevel(level);
  std::move(callback).Run(controller->GetZoomLevel());
}

void WebDeckShell::Print(int32_t tab_id) {
  // chrome::Print prints the window's active tab; the shell only prints the
  // staged (active) tab, so `tab_id` is not addressed individually here.
  if (BrowserWindowInterface* window = GetWindow()) {
    chrome::Print(window);
  }
}

void WebDeckShell::OpenDevTools(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // TODO(webdeck): Force the DevTools window undocked. A WebDeck window's stage
  // owns the docked contents-resizing strategy, so DevTools must not dock into
  // it. The public DevToolsWindow::OpenDevToolsWindow() API exposes no
  // force-undock parameter for a tab target; the frontend derives its dock
  // state from DevtoolsUIController::CanDockDevtools() (true for TYPE_NORMAL
  // windows, which a WebDeck window currently is) and the saved dock-state
  // pref. Undocking should be guaranteed by making the WebDeck window report
  // CanDockDevtools()==false (or by routing a currentDockState=undocked
  // settings blob through a Create/ToggleDevToolsWindow path).
  DevToolsWindow::OpenDevToolsWindow(contents, DevToolsToggleAction::Show(),
                                     DevToolsOpenedByAction::kUnknown);
}

void WebDeckShell::TogglePictureInPicture(int32_t tab_id) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents) {
    return;
  }
  // Exit path (unambiguous): if a PiP window opened by THIS tab is showing,
  // close it. PictureInPictureWindowManager tracks a single global PiP window
  // and reports its opener via GetWebContents(); ExitPictureInPicture() closes
  // any open video/document PiP window. Scoping the toggle to this tab keeps a
  // per-tab button honest when another tab owns the current PiP window.
  PictureInPictureWindowManager* manager =
      PictureInPictureWindowManager::GetInstance();
  if (manager && manager->GetWebContents() == contents) {
    manager->ExitPictureInPicture();
    return;
  }
  // Enter path: video PiP is renderer-initiated by design (the mode is entered
  // through WebContentsDelegate::EnterPictureInPicture, see
  // PictureInPictureWindowManager::EnterVideoPictureInPicture docs), so the
  // browser cannot synthesize a video controller here. The supported
  // browser-side request is to dispatch the media-session PiP action — the same
  // mechanism global media controls and media keys use — which the page's
  // MediaSession turns into an enterpictureinpicture event for the active
  // video. It is a no-op if the tab has no media session / registered handler
  // (nothing is playing), which is the correct behavior for a stateless toggle.
  if (content::MediaSession* session =
          content::MediaSession::GetIfExists(contents)) {
    session->DidReceiveAction(
        media_session::mojom::MediaSessionAction::kEnterPictureInPicture);
  }
}

void WebDeckShell::GetPageText(int32_t tab_id, GetPageTextCallback callback) {
  content::WebContents* contents = GetTabById(tab_id);
  content::RenderFrameHost* frame =
      contents ? contents->GetPrimaryMainFrame() : nullptr;
  if (!frame) {
    // The tab is gone or belongs to another window (GetTabById's ownership
    // gate) — reply with empty rather than reading something we do not own.
    std::move(callback).Run(std::string());
    return;
  }
  // Read the RENDERED visible text of the main frame. Two deliberate choices:
  //  * ExecuteJavaScriptInIsolatedWorld, not ExecuteJavaScript — the latter is
  //    restricted to chrome:// / devtools:// pages, and this reads arbitrary web
  //    pages. The isolated world shares the DOM but is invisible to page script,
  //    so a hostile page can neither observe nor tamper with the read.
  //  * innerText, not textContent — it is the visible, rendered text (skips
  //    hidden nodes / script / style), which is what the assistant should see.
  // The reply is wrapped so a frame that is destroyed before the eval returns
  // still sends an (empty) reply instead of hanging the renderer's promise.
  frame->ExecuteJavaScriptInIsolatedWorld(
      u"(document.body && document.body.innerText) || ''",
      base::BindOnce(&OnPageTextExtracted,
                     mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                         std::move(callback), std::string())),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}

void WebDeckShell::GetBlockThirdPartyCookies(
    GetBlockThirdPartyCookiesCallback callback) {
  Profile* profile = GetProfile();
  const bool blocked =
      profile &&
      profile->GetPrefs()->GetInteger(prefs::kCookieControlsMode) ==
          static_cast<int>(
              content_settings::CookieControlsMode::kBlockThirdParty);
  std::move(callback).Run(blocked);
}

void WebDeckShell::SetBlockThirdPartyCookies(bool blocked) {
  // The pref IS the source of truth chrome://settings writes; CookieSettings /
  // HostContentSettingsMap observe it. kBlockThirdParty blocks 3P cookies in
  // every context; kOff is the permissive default.
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetInteger(
        prefs::kCookieControlsMode,
        static_cast<int>(
            blocked ? content_settings::CookieControlsMode::kBlockThirdParty
                    : content_settings::CookieControlsMode::kOff));
  }
}

void WebDeckShell::GetSendDoNotTrack(GetSendDoNotTrackCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(prefs::kEnableDoNotTrack));
}

void WebDeckShell::SetSendDoNotTrack(bool enabled) {
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(prefs::kEnableDoNotTrack, enabled);
  }
}

void WebDeckShell::GetHttpsOnlyMode(GetHttpsOnlyModeCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(prefs::kHttpsOnlyModeEnabled));
}

void WebDeckShell::SetHttpsOnlyMode(bool enabled) {
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(prefs::kHttpsOnlyModeEnabled, enabled);
  }
}

void WebDeckShell::GetPreloadPages(GetPreloadPagesCallback callback) {
  Profile* profile = GetProfile();
  const bool enabled =
      profile && prefetch::GetPreloadPagesState(*profile->GetPrefs()) !=
                     prefetch::PreloadPagesState::kNoPreloading;
  std::move(callback).Run(enabled);
}

void WebDeckShell::SetPreloadPages(bool enabled) {
  // The typed helper is the sanitized front to the NetworkPredictionOptions
  // pref (which carries a deprecated value); use it rather than writing the raw
  // enum. Standard preloading maps to the settings "Standard" opt-in.
  if (Profile* profile = GetProfile()) {
    prefetch::SetPreloadPagesState(
        profile->GetPrefs(),
        enabled ? prefetch::PreloadPagesState::kStandardPreloading
                : prefetch::PreloadPagesState::kNoPreloading);
  }
}

void WebDeckShell::GetAdblockEnabled(GetAdblockEnabledCallback callback) {
  Profile* profile = GetProfile();
  std::move(callback).Run(
      profile && profile->GetPrefs()->GetBoolean(kWebDeckAdblockEnabled));
}

void WebDeckShell::SetAdblockEnabled(bool enabled) {
  // The pref is the source of truth. CreateURLLoaderThrottles reads it per
  // request on the UI thread and only installs the blocking throttle while it
  // is true, so toggling here takes effect on the next request with no restart.
  if (Profile* profile = GetProfile()) {
    profile->GetPrefs()->SetBoolean(kWebDeckAdblockEnabled, enabled);
  }
}

void WebDeckShell::GetAdblockBlockedCount(
    GetAdblockBlockedCountCallback callback) {
  std::move(callback).Run(AdblockBlockedCount());
}

void WebDeckShell::ClearBrowsingData(bool cookies,
                                     bool cache,
                                     bool history,
                                     int32_t time_range,
                                     ClearBrowsingDataCallback callback) {
  Profile* profile = GetProfile();
  if (!profile) {
    std::move(callback).Run();
    return;
  }
  uint64_t remove_mask = 0;
  if (cookies) {
    remove_mask |= content::BrowsingDataRemover::DATA_TYPE_COOKIES;
  }
  if (cache) {
    remove_mask |= content::BrowsingDataRemover::DATA_TYPE_CACHE;
  }
  if (history) {
    // History is an embedder (chrome) datatype, not a content datatype.
    remove_mask |= chrome_browsing_data_remover::DATA_TYPE_HISTORY;
  }
  if (remove_mask == 0) {
    std::move(callback).Run();
    return;
  }

  const base::Time now = base::Time::Now();
  base::Time begin;
  switch (time_range) {
    case 0:
      begin = now - base::Hours(1);
      break;
    case 1:
      begin = now - base::Days(1);
      break;
    case 2:
      begin = now - base::Days(7);
      break;
    case 3:
      begin = now - base::Days(28);
      break;
    default:
      begin = base::Time();  // The epoch — "all time".
      break;
  }

  // Fire-and-forget: BrowsingDataRemover runs the deletion on its own tasks. We
  // ack as soon as it is scheduled rather than plumb an Observer through, which
  // keeps this method (and the WebDeckShell lifetime) simple; the panel does not
  // need per-datatype completion, only that the clear was accepted.
  profile->GetBrowsingDataRemover()->Remove(
      begin, base::Time::Max(), remove_mask,
      content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB |
          content::BrowsingDataRemover::ORIGIN_TYPE_PROTECTED_WEB);
  std::move(callback).Run();
}

void WebDeckShell::GetDefaultBrowserState(
    GetDefaultBrowserStateCallback callback) {
  // The worker checks the OS on a blocking sequence and calls back on the UI
  // thread; it self-retains for the duration (StartCheckIsDefault binds `this`,
  // a RefCountedThreadSafe receiver, so Bind holds a scoped_refptr).
  scoped_refptr<shell_integration::DefaultBrowserWorker> worker =
      base::MakeRefCounted<shell_integration::DefaultBrowserWorker>();
  worker->StartCheckIsDefault(base::BindOnce(
      [](GetDefaultBrowserStateCallback cb,
         shell_integration::DefaultWebClientState state) {
        std::move(cb).Run(DefaultBrowserStateCode(state));
      },
      std::move(callback)));
}

void WebDeckShell::SetAsDefaultBrowser(SetAsDefaultBrowserCallback callback) {
  scoped_refptr<shell_integration::DefaultBrowserWorker> worker =
      base::MakeRefCounted<shell_integration::DefaultBrowserWorker>();
  // Allow the interactive OS flow (macOS/Linux present a system prompt); without
  // it the set silently fails on those platforms.
  worker->set_interactive_permitted(true);
  worker->StartSetAsDefault(base::BindOnce(
      [](SetAsDefaultBrowserCallback cb,
         shell_integration::DefaultWebClientState state) {
        std::move(cb).Run(DefaultBrowserStateCode(state));
      },
      std::move(callback)));
}

void WebDeckShell::GetExtensionActions(int32_t tab_id,
                                       GetExtensionActionsCallback callback) {
  std::vector<mojom::ExtensionActionInfoPtr> out;
  Profile* profile = GetProfile();
  content::WebContents* contents = GetTabById(tab_id);
  // ToolbarActionsModel is the authority on what "pinned to the toolbar" means
  // — it is the same list Chromium's own toolbar draws, and the same one the
  // "Pin to toolbar" switch in chrome://extensions writes. Reading it here is
  // what makes that switch do something in a browser whose toolbar is HTML.
  ToolbarActionsModel* model =
      profile ? ToolbarActionsModel::Get(profile) : nullptr;
  if (!model || !contents) {
    std::move(callback).Run(std::move(out));
    return;
  }
  // Extensions address tabs by session id, not by our shell's tab id.
  const int session_tab_id =
      sessions::SessionTabHelper::IdForTab(contents).id();
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  extensions::ExtensionActionManager* actions =
      extensions::ExtensionActionManager::Get(profile);
  if (!registry || !actions) {
    std::move(callback).Run(std::move(out));
    return;
  }
  for (const auto& action_id : model->pinned_action_ids()) {
    const extensions::Extension* extension =
        registry->enabled_extensions().GetByID(action_id);
    if (!extension) {
      // A pinned id can outlive the extension (disabled, or removed while the
      // pref survives). Skipping is right: there is nothing to draw.
      continue;
    }
    extensions::ExtensionAction* action =
        actions->GetExtensionAction(*extension);
    if (!action) {
      continue;
    }
    auto info = mojom::ExtensionActionInfo::New();
    info->id = extension->id();
    info->name = extension->name();
    info->title = action->GetTitle(session_tab_id);
    info->badge_text = action->GetExplicitlySetBadgeText(session_tab_id);
    info->enabled = action->GetIsVisible(session_tab_id);
    info->has_popup = action->HasPopup(session_tab_id);
    out.push_back(std::move(info));
  }
  std::move(callback).Run(std::move(out));
}

void WebDeckShell::RunExtensionAction(int32_t tab_id,
                                      const std::string& extension_id,
                                      RunExtensionActionCallback callback) {
  Profile* profile = GetProfile();
  content::WebContents* contents = GetTabById(tab_id);
  if (!profile || !contents) {
    std::move(callback).Run(false);
    return;
  }
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  const extensions::Extension* extension =
      registry ? registry->enabled_extensions().GetByID(extension_id) : nullptr;
  extensions::ExtensionActionRunner* runner =
      extensions::ExtensionActionRunner::GetForWebContents(contents);
  if (!extension || !runner) {
    std::move(callback).Run(false);
    return;
  }
  // RunAction is the same entry point the native button uses: it grants
  // activeTab for this page and fires onClicked, then tells us whether the
  // extension wants a popup shown.
  const extensions::ExtensionAction::ShowAction show =
      runner->RunAction(extension, /*grant_tab_permissions=*/true);
  if (show != extensions::ExtensionAction::ShowAction::kShowPopup) {
    std::move(callback).Run(false);
    return;
  }
  extensions::ExtensionActionManager* actions =
      extensions::ExtensionActionManager::Get(profile);
  extensions::ExtensionAction* action =
      actions ? actions->GetExtensionAction(*extension) : nullptr;
  const int session_tab_id =
      sessions::SessionTabHelper::IdForTab(contents).id();
  const GURL popup = action ? action->GetPopupUrl(session_tab_id) : GURL();
  if (!popup.is_valid()) {
    std::move(callback).Run(false);
    return;
  }
  ShowExtensionPopup(popup);
  std::move(callback).Run(true);
}

void WebDeckShell::ShowExtensionPopup(const GURL& url) {
  Profile* profile = GetProfile();
  if (!profile) {
    return;
  }
  // Chromium anchors a real extension popup to its toolbar button, which this
  // build does not have — the toolbar is the shell's own HTML. A popup window
  // is the honest approximation: the extension's page, in its own small
  // window, with the same origin and permissions it would have in a bubble.
  NavigateParams params(profile, url, ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  params.disposition = WindowOpenDisposition::NEW_POPUP;
  // NEW_POPUP shows the window on its own; only the size needs saying.
  params.window_features.bounds = gfx::Rect(0, 0, 400, 600);
  params.window_features.has_width = true;
  params.window_features.has_height = true;
  // Qualified: WebDeckShell has its own Navigate(tab_id, url).
  ::Navigate(&params);
}

namespace {

// Every Chromium preference the shell's settings may read or write.
//
// This list IS the security boundary for GetSettingPrefs/SetSettingPref: it is
// what stops a compromised chrome://webdeck renderer from turning off Safe
// Browsing, redirecting the proxy, or reading anything else in the profile by
// name. Adding a row is a deliberate act — it must be a setting a person is
// meant to change from a settings page, and nothing else.
//
// `local_state` marks the browser-wide prefs (they live in Local State, not
// the profile), which is where Chrome keeps the ones that outlive a profile.
struct AllowedPref {
  const char* name;
  base::Value::Type type;
  bool local_state;
  // Readable but not writable. A path or a language list is shown in the
  // settings surface and changed on Chromium's own page, which validates it —
  // so there is no reason for this interface to accept a new value, and every
  // reason not to: an arbitrary download directory plus "don't ask where to
  // save" is a writeable-path primitive.
  bool writable;
};

// The profile picture the shell draws, at the size its button needs.
constexpr int kAvatarSize = 64;

constexpr AllowedPref kAllowedPrefs[] = {
    // Appearance
    {"bookmark_bar.show_on_all_tabs", base::Value::Type::BOOLEAN, false, true},
    {"browser.show_home_button", base::Value::Type::BOOLEAN, false, true},
    {"webkit.webprefs.default_font_size", base::Value::Type::INTEGER, false, true},
    // On startup
    {"session.restore_on_startup", base::Value::Type::INTEGER, false, true},
    // Downloads
    {"download.prompt_for_download", base::Value::Type::BOOLEAN, false, true},
    {"download.default_directory", base::Value::Type::STRING, false, false},
    // Autofill and passwords
    {"autofill.profile_enabled", base::Value::Type::BOOLEAN, false, true},
    {"autofill.credit_card_enabled", base::Value::Type::BOOLEAN, false, true},
    {"credentials_enable_service", base::Value::Type::BOOLEAN, false, true},
    {"credentials_enable_autosignin", base::Value::Type::BOOLEAN, false, true},
    // Privacy and security
    {"safebrowsing.enabled", base::Value::Type::BOOLEAN, false, true},
    {"safebrowsing.enhanced", base::Value::Type::BOOLEAN, false, true},
    {"search.suggest_enabled", base::Value::Type::BOOLEAN, false, true},
    {"alternate_error_pages.enabled", base::Value::Type::BOOLEAN, false, true},
    {"dns_over_https.mode", base::Value::Type::STRING, true, true},
    {"privacy_sandbox.m1.topics_enabled", base::Value::Type::BOOLEAN, false, true},
    {"privacy_sandbox.m1.fledge_enabled", base::Value::Type::BOOLEAN, false, true},
    {"privacy_sandbox.m1.ad_measurement_enabled", base::Value::Type::BOOLEAN, false, true},
    // Performance
    {"performance_tuning.high_efficiency_mode.state",
     base::Value::Type::INTEGER, true, true},
    {"performance_tuning.battery_saver_mode.state", base::Value::Type::INTEGER, true, true},
    // Languages and spell-check
    {"browser.enable_spellchecking", base::Value::Type::BOOLEAN, false, true},
    {"intl.accept_languages", base::Value::Type::STRING, false, false},
    // Accessibility
    {"settings.a11y.focus_highlight", base::Value::Type::BOOLEAN, false, true},
    {"accessibility.captions.live_caption_enabled", base::Value::Type::BOOLEAN, false, true},
    {"settings.a11y.caretbrowsing.enabled", base::Value::Type::BOOLEAN, false, true},
    // System
    {"hardware_acceleration_mode.enabled", base::Value::Type::BOOLEAN, true, true},
    {"background_mode.enabled", base::Value::Type::BOOLEAN, true, true},
};

const AllowedPref* FindAllowedPref(const std::string& name) {
  for (const AllowedPref& pref : kAllowedPrefs) {
    if (name == pref.name) {
      return &pref;
    }
  }
  return nullptr;
}

}  // namespace

void WebDeckShell::GetSettingPrefs(const std::vector<std::string>& names,
                                   GetSettingPrefsCallback callback) {
  std::vector<mojom::SettingPrefPtr> out;
  Profile* profile = GetProfile();
  for (const std::string& name : names) {
    auto entry = mojom::SettingPref::New();
    entry->name = name;
    entry->managed = false;
    entry->unavailable = true;
    const AllowedPref* allowed = FindAllowedPref(name);
    PrefService* prefs = nullptr;
    if (allowed) {
      prefs = allowed->local_state ? g_browser_process->local_state()
                                   : (profile ? profile->GetPrefs() : nullptr);
    }
    // A name that is not allowlisted is reported exactly like one this build
    // does not register: the shell learns nothing about the profile from it.
    const PrefService::Preference* pref =
        prefs ? prefs->FindPreference(name) : nullptr;
    // `allowed` is re-tested rather than inferred from `prefs` being non-null:
    // the two are only linked by the block above, and a reader should not have
    // to prove that to know this dereference is safe.
    if (allowed && pref && pref->GetType() == allowed->type) {
      entry->unavailable = false;
      entry->managed = !pref->IsUserModifiable();
      std::string json;
      if (base::JSONWriter::Write(*pref->GetValue(), &json)) {
        entry->json_value = json;
      }
    }
    out.push_back(std::move(entry));
  }
  std::move(callback).Run(std::move(out));
}

void WebDeckShell::SetSettingPref(const std::string& name,
                                 const std::string& json_value,
                                 SetSettingPrefCallback callback) {
  const AllowedPref* allowed = FindAllowedPref(name);
  // Not on the list, or on it only to be read: refuse. The settings surface
  // shows these and sends the user to Chromium's own page to change them.
  if (!allowed || !allowed->writable) {
    std::move(callback).Run(false);
    return;
  }
  Profile* profile = GetProfile();
  PrefService* prefs = allowed->local_state
                           ? g_browser_process->local_state()
                           : (profile ? profile->GetPrefs() : nullptr);
  const PrefService::Preference* pref =
      prefs ? prefs->FindPreference(name) : nullptr;
  if (!pref || pref->GetType() != allowed->type) {
    std::move(callback).Run(false);
    return;
  }
  // Policy wins. chrome://settings draws a managed pref disabled; writing it
  // here would silently do nothing, so say so instead.
  if (!pref->IsUserModifiable()) {
    std::move(callback).Run(false);
    return;
  }
  // No comments, no trailing commas: this is a value the renderer produced
  // with JSON.stringify, not a config file.
  std::optional<base::Value> parsed =
      base::JSONReader::Read(json_value, base::JSON_PARSE_RFC);
  if (!parsed || parsed->type() != allowed->type) {
    std::move(callback).Run(false);
    return;
  }
  prefs->Set(name, *parsed);
  std::move(callback).Run(true);
}

void WebDeckShell::GetAccountInfo(GetAccountInfoCallback callback) {
  auto info = mojom::SignInInfo::New();
  info->signed_in = false;
  Profile* profile = GetProfile();
  if (!profile) {
    std::move(callback).Run(std::move(info));
    return;
  }
  // The local profile's display name exists whether or not anyone is signed
  // in, and it is what the button falls back to.
  ProfileAttributesEntry* entry =
      g_browser_process->profile_manager()
          ->GetProfileAttributesStorage()
          .GetProfileAttributesWithPath(profile->GetPath());
  if (entry) {
    info->profile_name = base::UTF16ToUTF8(entry->GetName());
    // The local profile picture — the one chrome://settings/manageProfile
    // sets. It exists whether or not anyone is signed in to Google, which on
    // this build is the only picture there will ever be. Overwritten below by
    // the Google account image when there is one.
    const gfx::Image avatar = entry->GetAvatarIcon(kAvatarSize);
    if (!avatar.IsEmpty()) {
      scoped_refptr<base::RefCountedMemory> png = avatar.As1xPNGBytes();
      if (png && png->size() > 0) {
        info->avatar_data_url = "data:image/png;base64," + base::Base64Encode(*png);
      }
    }
  }
  // Without Google's API keys there is no OAuth client, so the sign-in flow
  // has nothing to talk to and Sync never starts. Reported so the UI can stop
  // offering it.
  info->signin_supported = google_apis::HasOAuthClientConfigured();
  signin::IdentityManager* identity =
      IdentityManagerFactory::GetForProfile(profile);
  if (!identity) {
    std::move(callback).Run(std::move(info));
    return;
  }
  // kSignin, not kSync: someone signed into the browser without turning sync on
  // still has an account and an avatar, and the menu should say so.
  const CoreAccountInfo core =
      identity->GetPrimaryAccountInfo(signin::ConsentLevel::kSignin);
  if (core.IsEmpty()) {
    std::move(callback).Run(std::move(info));
    return;
  }
  const ::AccountInfo account =
      identity->FindExtendedAccountInfoByAccountId(core.account_id);
  info->signed_in = true;
  info->email = core.email;
  const std::optional<std::string_view> full_name = account.GetFullName();
  if (full_name.has_value()) {
    info->full_name = std::string(full_name.value());
  }
  // The account image is a downloaded bitmap with no chrome:// URL the page
  // could load, so it travels as a data: URL. It is absent until the fetch
  // finishes, which is why the shell re-reads this on tab changes rather than
  // once at startup.
  const std::optional<gfx::Image> avatar = account.GetAvatarImage();
  if (avatar.has_value() && !avatar->IsEmpty()) {
    scoped_refptr<base::RefCountedMemory> png = avatar->As1xPNGBytes();
    if (png && png->size() > 0) {
      info->avatar_data_url =
          "data:image/png;base64," + base::Base64Encode(*png);
    }
  }
  std::move(callback).Run(std::move(info));
}

void WebDeckShell::SetClient(mojo::PendingRemote<mojom::ShellClient> client) {
  client_.reset();
  client_.Bind(std::move(client));
  // Now that the shell can receive state, observe the window's tabs and push the
  // active tab's current navigation state (url/title/back-forward/loading).
  StartObserving();
  // And take the window's shell-owned commands (menu / key equivalents fired
  // while the page had focus). Cleared in the destructor.
  if (BrowserWindowInterface* window = GetWindow()) {
    forwarding_window_ = window;
    // A WeakPtr cannot be the receiver of a bound method that returns a value,
    // so the weak pointer rides as an argument and is checked by hand.
    webdeck::SetCommandForwarder(
        window,
        base::BindRepeating(
            [](base::WeakPtr<WebDeckShell> shell, int command_id,
               bool execute) {
              return shell ? shell->ForwardCommand(command_id, execute)
                           : false;
            },
            weak_factory_.GetWeakPtr()));
    // Dropped files, for the same reason: only the browser knows where they
    // are, and the drop arrives on the window, not on the page.
    webdeck::SetFilesDropForwarder(
        window,
        base::BindRepeating(
            [](base::WeakPtr<WebDeckShell> shell,
               const std::vector<base::FilePath>& paths) {
              return shell ? shell->OnFilesDropped(paths) : paths;
            },
            weak_factory_.GetWeakPtr()));
    webdeck::RecordDropNote("shell registered for drops");
  }
}

// Chromium's command ids the shell owns in a WebDeck window, by stable name.
// Everything else (reload, back/forward, zoom, print, new window, downloads,
// history, view source, fullscreen…) stays native: it acts on the real tab or
// the real window and needs nothing from the shell.
bool WebDeckShell::ForwardCommand(int command_id, bool execute) {
  if (!client_.is_bound()) {
    return false;
  }
  std::string name;
  switch (command_id) {
    case IDC_NEW_TAB:              name = "new-tab"; break;
    case IDC_CLOSE_TAB:            name = "close-tab"; break;
    case IDC_SELECT_NEXT_TAB:      name = "next-tab"; break;
    case IDC_SELECT_PREVIOUS_TAB:  name = "prev-tab"; break;
    case IDC_SELECT_TAB_0:         name = "select-tab-1"; break;
    case IDC_SELECT_TAB_1:         name = "select-tab-2"; break;
    case IDC_SELECT_TAB_2:         name = "select-tab-3"; break;
    case IDC_SELECT_TAB_3:         name = "select-tab-4"; break;
    case IDC_SELECT_TAB_4:         name = "select-tab-5"; break;
    case IDC_SELECT_TAB_5:         name = "select-tab-6"; break;
    case IDC_SELECT_TAB_6:         name = "select-tab-7"; break;
    case IDC_SELECT_TAB_7:         name = "select-tab-8"; break;
    case IDC_SELECT_LAST_TAB:      name = "select-tab-last"; break;
    case IDC_RESTORE_TAB:          name = "reopen-tab"; break;
    case IDC_FOCUS_LOCATION:       name = "focus-address"; break;
    case IDC_FOCUS_SEARCH:         name = "focus-address"; break;
    case IDC_FIND:                 name = "find"; break;
    case IDC_FIND_NEXT:            name = "find-next"; break;
    case IDC_FIND_PREVIOUS:        name = "find-prev"; break;
    case IDC_BOOKMARK_THIS_TAB:    name = "bookmark"; break;
    case IDC_DEV_TOOLS:            name = "devtools"; break;
    case IDC_DEV_TOOLS_CONSOLE:    name = "devtools"; break;
    case IDC_DEV_TOOLS_INSPECT:    name = "devtools"; break;
    case IDC_WEBDECK_TOGGLE_DECK:  name = "toggle-deck"; break;
    // The File menu's Settings item and its Command-, accelerator. Chromium
    // would open chrome://settings in a tab, which is now what the browser
    // menu's own Settings does; this one opens WebDeck's settings instead, so
    // each menu leads to the settings it is named for.
    case IDC_OPTIONS:              name = "preferences"; break;
    default:
      return false;
  }
  if (!execute) {
    return true;
  }
  // Commands that put the user INTO the shell (the address bar, the find bar,
  // the start page's search field, the Deck) must also move keyboard focus
  // there: a DOM focus() in the shell page cannot take the window's first
  // responder away from the staged page's native view, so without this the
  // keystrokes that follow ⌘L keep going to the page.
  if (name == "focus-address" || name == "find" || name == "find-next" ||
      name == "find-prev" || name == "new-tab" || name == "toggle-deck" ||
      name == "preferences") {
    // Through the views FocusManager, not WebContents::Focus() alone: the
    // staged tab's WebView is the focused view, and only RequestFocus on the
    // shell's own WebView moves both the views focus and the native first
    // responder (WebView::OnFocus then focuses the shell WebContents).
    if (ContentsContainerView* container = GetContentsContainerView()) {
      if (views::WebView* shell_view = container->shell_web_view()) {
        shell_view->RequestFocus();
      }
    }
    shell_contents_->Focus();
  }
  client_->OnCommand(name);
  return true;
}

void WebDeckShell::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (selection.active_tab_changed()) {
    ObserveActiveTab();
  }
  // A removed tab must be reported individually so the shell can drop it (this
  // is how closed/crashed tabs disappear from the shell's tab strip).
  if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      int32_t tab_id = 0;
      if (removed.tab) {
        tab_id = removed.tab->GetHandle().raw_value();
      } else if (removed.contents) {
        if (tabs::TabInterface* tab =
                tabs::TabInterface::GetFromContents(removed.contents)) {
          tab_id = tab->GetHandle().raw_value();
        }
      }
      // Defensive split teardown: if the tab that just vanished is the one
      // staged in the secondary split pane, drop it from the container so a
      // blank pane is never left visible. The renderer may not proactively call
      // SetSplit(false) when its own tab dies. Guarded on a non-zero tracked id
      // so an unresolved (0) tab_id can never match.
      if (secondary_tab_id_ != 0 && tab_id == secondary_tab_id_) {
        if (ContentsContainerView* container = GetContentsContainerView()) {
          container->SetSecondaryStagedContents(nullptr);
        }
        secondary_tab_id_ = 0;
      }
      if (client_) {
        client_->OnTabClosed(tab_id);
      }
    }
  }
  // Any change to the tab set / active tab re-pushes the full list so the shell
  // learns about tabs opened elsewhere (e.g. links that open a new window).
  PushTabList();
  PushActiveTabState();
}

void WebDeckShell::DidFinishNavigation(
    content::NavigationHandle* navigation_handle) {
  if (navigation_handle && navigation_handle->IsInPrimaryMainFrame() &&
      navigation_handle->HasCommitted()) {
    PushActiveTabState();
  }
}

void WebDeckShell::DidStartLoading() {
  PushActiveTabState();
}

void WebDeckShell::DidStopLoading() {
  PushActiveTabState();
}

void WebDeckShell::TitleWasSet(content::NavigationEntry* entry) {
  PushActiveTabState();
}

void WebDeckShell::StartObserving() {
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  if (observed_model_ != model) {
    if (observed_model_) {
      observed_model_->RemoveObserver(this);
    }
    observed_model_ = model;
    model->AddObserver(this);
  }
  ObserveActiveTab();
  PushTabList();
  PushActiveTabState();
}

void WebDeckShell::ObserveActiveTab() {
  BrowserWindowInterface* window = GetWindow();
  content::WebContents* active =
      window ? window->GetTabStripModel()->GetActiveWebContents() : nullptr;
  // WebContentsObserver::Observe re-points at the new contents (or detaches on
  // null), so a single observer always tracks whatever tab is staged.
  Observe(active);

  // Re-point the find-result observer at the newly staged tab: drop the old
  // registration first, then register on the new tab's FindTabHelper so
  // OnFindResultAvailable fires for the staged tab.
  if (observed_find_helper_) {
    observed_find_helper_->RemoveObserver(this);
    observed_find_helper_ = nullptr;
  }
  if (active) {
    find_in_page::FindTabHelper::CreateForWebContents(active);
    observed_find_helper_ = find_in_page::FindTabHelper::FromWebContents(active);
    if (observed_find_helper_) {
      observed_find_helper_->AddObserver(this);
    }
  }
}

void WebDeckShell::PushActiveTabState() {
  if (!client_) {
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  content::WebContents* contents =
      window->GetTabStripModel()->GetActiveWebContents();
  if (!contents) {
    return;
  }
  mojom::TabInfoPtr info = mojom::TabInfo::New();
  info->tab_id = 0;
  if (tabs::TabInterface* tab = tabs::TabInterface::GetFromContents(contents)) {
    info->tab_id = tab->GetHandle().raw_value();
  }
  info->url = contents->GetLastCommittedURL().spec();
  info->title = base::UTF16ToUTF8(contents->GetTitle());
  info->can_go_back = contents->GetController().CanGoBack();
  info->can_go_forward = contents->GetController().CanGoForward();
  info->is_loading = contents->IsLoading();
  client_->OnTabNavigationStateChanged(std::move(info));
}

void WebDeckShell::PushTabList() {
  if (!client_) {
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  if (!window) {
    return;
  }
  TabStripModel* model = window->GetTabStripModel();
  std::vector<mojom::TabInfoPtr> list;
  for (int i = 0; i < model->count(); ++i) {
    content::WebContents* contents = model->GetWebContentsAt(i);
    if (!contents) {
      continue;
    }
    mojom::TabInfoPtr info = mojom::TabInfo::New();
    info->tab_id = 0;
    if (tabs::TabInterface* tab =
            tabs::TabInterface::GetFromContents(contents)) {
      info->tab_id = tab->GetHandle().raw_value();
    }
    info->url = contents->GetLastCommittedURL().spec();
    info->title = base::UTF16ToUTF8(contents->GetTitle());
    info->can_go_back = contents->GetController().CanGoBack();
    info->can_go_forward = contents->GetController().CanGoForward();
    info->is_loading = contents->IsLoading();
    list.push_back(std::move(info));
  }

  int32_t active_tab_id = 0;
  if (content::WebContents* active = model->GetActiveWebContents()) {
    if (tabs::TabInterface* tab =
            tabs::TabInterface::GetFromContents(active)) {
      active_tab_id = tab->GetHandle().raw_value();
    }
  }
  client_->OnTabsChanged(std::move(list), active_tab_id);
}

void WebDeckShell::OnFindResultAvailable(content::WebContents* web_contents) {
  if (!client_ || !web_contents) {
    return;
  }
  find_in_page::FindTabHelper* helper =
      find_in_page::FindTabHelper::FromWebContents(web_contents);
  if (!helper) {
    return;
  }
  int32_t tab_id = 0;
  if (tabs::TabInterface* tab =
          tabs::TabInterface::GetFromContents(web_contents)) {
    tab_id = tab->GetHandle().raw_value();
  }
  const find_in_page::FindNotificationDetails& details = helper->find_result();
  client_->OnFindResult(tab_id, details.active_match_ordinal(),
                        details.number_of_matches());
}

void WebDeckShell::OnFindTabHelperDestroyed(
    find_in_page::FindTabHelper* helper) {
  // The helper we observe is going away; drop the dangling registration.
  if (observed_find_helper_ == helper) {
    observed_find_helper_ = nullptr;
  }
}

// The shell hides the staged tab while one of its own overlays is open: the
// native tab is composited above the page, so a menu or the palette would
// otherwise be painted over. Both stages go together — a split secondary
// left visible would still cover the overlay.
void WebDeckShell::SetStageVisible(bool visible) {
  ContentsContainerView* container = GetContentsContainerView();
  if (!container) {
    return;
  }
  if (views::View* contents = container->contents_view()) {
    contents->SetVisible(visible);
  }
  container->SetSecondaryStageVisible(visible);
}

// A still of the staged tab for the shell to show while the stage is hidden
// (see SetStageVisible). Copied from the compositor surface, so it is exactly
// what the window shows, and encoded off the UI thread. The reply is wrapped
// so a copy that never completes still answers "" instead of hanging the
// shell's promise — the shell then hides the stage bare, as it always did.
void WebDeckShell::CaptureStage(int32_t tab_id,
                                CaptureStageCallback callback) {
  content::WebContents* contents = GetTabById(tab_id);
  content::RenderWidgetHostView* view =
      contents ? contents->GetRenderWidgetHostView() : nullptr;
  if (!view || !view->IsSurfaceAvailableForCopy()) {
    std::move(callback).Run(std::string());
    return;
  }
  // The still is shown at the view's own size, so native pixels are what it
  // needs — up to a point. On a 5K or 6K display a 2x view is 5000+ pixels
  // wide, and that bitmap costs a tenth of a second to encode and tens of
  // megabytes as a data: URL. Past kMaxStillEdge the copy is asked for a
  // scaled bitmap instead; the GPU scales it, and the shell stretches it back
  // over the frame, where the loss is invisible under a menu.
  constexpr int kMaxStillEdge = 2560;
  gfx::Size output_size;
  const gfx::Size pixels = gfx::ScaleToCeiledSize(
      view->GetViewBounds().size(), view->GetDeviceScaleFactor());
  const int longest = std::max(pixels.width(), pixels.height());
  if (longest > kMaxStillEdge) {
    output_size = gfx::ScaleToFlooredSize(
        pixels, static_cast<float>(kMaxStillEdge) / longest);
  }
  view->CopyFromSurface(
      /*src_rect=*/gfx::Rect(), output_size,
      base::TimeDelta(),
      base::BindPostTask(
          base::SequencedTaskRunner::GetCurrentDefault(),
          base::BindOnce(&OnStageCopied,
                         mojo::WrapCallbackWithDefaultInvokeIfNotRun(
                             std::move(callback), std::string()))));
}

// Another WebDeck window whose shell page carries a role in its fragment
// (chrome://webdeck#deck, #float:<group>). Only chrome://webdeck may be a
// shell page; anything else is refused with id 0. The URL is handed to the
// next ContentsContainerView through the shell host rather than through
// browser creation params, which have no slot for it.
void WebDeckShell::OpenWindow(const std::string& url,
                              OpenWindowCallback callback) {
  const GURL target(url);
  Profile* profile = GetProfile();
  if (!profile || !target.SchemeIs(content::kChromeUIScheme) ||
      target.host() != chrome::kChromeUIWebDeckHost) {
    std::move(callback).Run(0);
    return;
  }
  webdeck::SetNextShellUrl(target);
  BrowserWindowInterface* window =
      chrome::OpenEmptyWindow(profile, /*should_trigger_session_restore=*/false);
  // Whether or not a window came up, the pending URL must not leak into the
  // next unrelated window.
  webdeck::TakeNextShellUrl();
  std::move(callback).Run(window ? window->GetSessionID().id() : 0);
}

namespace {
BrowserWindowInterface* FindBrowserById(int32_t window_id) {
  for (BrowserWindowInterface* browser : GetAllBrowserWindowInterfaces()) {
    if (browser->GetSessionID().id() == window_id) {
      return browser;
    }
  }
  return nullptr;
}
}  // namespace

void WebDeckShell::FocusWindow(int32_t window_id) {
  if (BrowserWindowInterface* browser = FindBrowserById(window_id)) {
    browser->GetWindow()->Activate();
  }
}

void WebDeckShell::CloseWindow(int32_t window_id) {
  if (BrowserWindowInterface* browser = FindBrowserById(window_id)) {
    browser->GetWindow()->Close();
  }
}

// The native open panel, sheeted on the shell's window. A privileged WebUI page
// may learn real paths — the core opens projects and reads attachments by path,
// so this is the one place a path can honestly come from. One panel at a time;
// the reply is owed until the panel answers (FileSelected / MultiFilesSelected /
// FileSelectionCanceled) or the shell goes away (dtor: ListenerDestroyed, and
// the callback is dropped, which Mojo reports as a disconnected reply).
namespace {

// A picked image, as a data: URL of its own bytes. Runs on the thread pool.
//
// Capped: a profile picture is a small file, and the whole thing crosses Mojo
// and then a JSON settings write, so an arbitrarily large pick would be paid
// for three times over. The page re-encodes it to a 128px square PNG anyway.
constexpr size_t kMaxPickedImageBytes = 16 * 1024 * 1024;

std::string ReadImageAsDataUrl(const base::FilePath& path) {
  std::optional<int64_t> size = base::GetFileSize(path);
  if (!size || *size <= 0 || static_cast<size_t>(*size) > kMaxPickedImageBytes) {
    return std::string();
  }
  std::string bytes;
  if (!base::ReadFileToStringWithMaxSize(path, &bytes, kMaxPickedImageBytes)) {
    return std::string();
  }
  // The type is named from the extension the panel filtered on. The page hands
  // these bytes to an <img>, which sniffs them itself and refuses anything that
  // is not really an image — the label only has to be plausible.
  const std::string extension = base::ToLowerASCII(path.FinalExtension());
  std::string mime = "image/png";
  if (extension == ".jpg" || extension == ".jpeg") {
    mime = "image/jpeg";
  } else if (extension == ".gif") {
    mime = "image/gif";
  } else if (extension == ".webp") {
    mime = "image/webp";
  } else if (extension == ".svg") {
    mime = "image/svg+xml";
  }
  return "data:" + mime + ";base64," + base::Base64Encode(bytes);
}

}  // namespace

void WebDeckShell::PickImage(PickImageCallback callback) {
  if (select_file_dialog_) {
    std::move(callback).Run(std::string());
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  gfx::NativeWindow owner =
      window ? window->GetWindow()->GetNativeWindow() : gfx::NativeWindow();

  ui::SelectFileDialog::FileTypeInfo file_types;
  file_types.allowed_paths = ui::SelectFileDialog::FileTypeInfo::NATIVE_PATH;
  file_types.extensions = {{FILE_PATH_LITERAL("png"), FILE_PATH_LITERAL("jpg"),
                            FILE_PATH_LITERAL("jpeg"), FILE_PATH_LITERAL("gif"),
                            FILE_PATH_LITERAL("webp")}};

  pick_image_callback_ = std::move(callback);
  select_file_dialog_ = ui::SelectFileDialog::Create(
      this, std::make_unique<ChromeSelectFilePolicy>(shell_contents_));
  select_file_dialog_->SelectFile(ui::SelectFileDialog::SELECT_OPEN_FILE,
                                  u"Choose a Picture", base::FilePath(),
                                  &file_types, 0,
                                  base::FilePath::StringType(), owner);
}

// Read the picked image off the UI thread, then answer the page.
void WebDeckShell::ReplyWithPickedImage(const base::FilePath& path) {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::BindOnce(&ReadImageAsDataUrl, path),
      base::BindOnce(
          [](PickImageCallback callback, std::string data_url) {
            std::move(callback).Run(std::move(data_url));
          },
          std::move(pick_image_callback_)));
}

void WebDeckShell::PickPaths(int32_t mode, PickPathsCallback callback) {
  if (select_file_dialog_) {
    std::move(callback).Run({});
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  gfx::NativeWindow owner =
      window ? window->GetWindow()->GetNativeWindow() : gfx::NativeWindow();

  ui::SelectFileDialog::Type type = ui::SelectFileDialog::SELECT_OPEN_MULTI_FILE;
  std::u16string title = u"Attach Files";
  ui::SelectFileDialog::FileTypeInfo file_types;
  file_types.allowed_paths = ui::SelectFileDialog::FileTypeInfo::NATIVE_PATH;
  switch (mode) {
    case 1:
      type = ui::SelectFileDialog::SELECT_FOLDER;
      title = u"Open Project Folder";
      break;
    case 2:
      title = u"Attach Images";
      file_types.extensions = {{FILE_PATH_LITERAL("png"), FILE_PATH_LITERAL("jpg"),
                                FILE_PATH_LITERAL("jpeg"), FILE_PATH_LITERAL("gif"),
                                FILE_PATH_LITERAL("webp"), FILE_PATH_LITERAL("svg")}};
      file_types.include_all_files = true;
      break;
    default:
      break;
  }

  pick_paths_callback_ = std::move(callback);
  select_file_dialog_ = ui::SelectFileDialog::Create(
      this, std::make_unique<ChromeSelectFilePolicy>(shell_contents_));
  select_file_dialog_->SelectFile(type, title, base::FilePath(), &file_types, 0,
                                  base::FilePath::StringType(), owner);
}

namespace {

// Files WebDeck reads itself: documents in Document Studio's styled view,
// source and plain text in its source view. Everything else — PDF, images,
// HTML — is Chromium's, which renders those properly. The two lists mirror
// DOC_EXTENSIONS and EDITOR_EXTENSIONS in app/src/shared/ipc.ts, where the
// page decides which view a claimed file gets; a type claimed here and unknown
// there would vanish, so the lists move together.
bool IsDocumentFile(const base::FilePath& path) {
  static constexpr const char* kDocumentExtensions[] = {
      ".md", ".markdown", ".json", ".yaml", ".yml",
      ".toml", ".csv", ".tsv", ".xml", ".svg"};
  static constexpr const char* kEditorExtensions[] = {
      ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte",
      ".go", ".rs", ".java", ".kt", ".swift", ".dart", ".scala", ".c", ".cc",
      ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".lua", ".pl", ".r", ".jl",
      ".ex", ".exs", ".hs", ".zig", ".sh", ".bash", ".zsh", ".fish", ".ps1",
      ".bat", ".sql", ".graphql", ".gql", ".proto", ".tf", ".hcl", ".css",
      ".scss", ".less", ".txt", ".log", ".ini", ".cfg", ".conf", ".env"};
  const std::string extension = base::ToLowerASCII(path.FinalExtension());
  for (const char* candidate : kDocumentExtensions) {
    if (extension == candidate) {
      return true;
    }
  }
  for (const char* candidate : kEditorExtensions) {
    if (extension == candidate) {
      return true;
    }
  }
  return false;
}

// A path the core will accept, because this browser signed it. Null when the
// core is not up, which is also when nothing can be granted anyway.
mojom::SignedFilePtr SignForShell(const base::FilePath& path) {
  const std::string auth =
      WebDeckCoreService::GetInstance()->SignFileGrant(path);
  if (auth.empty()) {
    return nullptr;
  }
  mojom::SignedFilePtr file = mojom::SignedFile::New();
  file->path = path.AsUTF8Unsafe();
  file->auth = auth;
  return file;
}

}  // namespace

bool WebDeckShell::NavigateToLocalFile(int32_t tab_id,
                                       const base::FilePath& path) {
  content::WebContents* contents = GetTabById(tab_id);
  if (!contents || path.empty()) {
    return false;
  }
  const GURL url = net::FilePathToFileURL(path);
  if (!url.is_valid()) {
    return false;
  }
  // Deliberately not through IsAllowedShellUrl: that gate exists to stop the
  // PAGE naming a local path, and neither caller here took one from the page.
  contents->GetController().LoadURL(url, content::Referrer(),
                                    ui::PAGE_TRANSITION_AUTO_TOPLEVEL,
                                    std::string());
  return true;
}

// Nothing happened: neither navigated nor staged.
static mojom::LocalFileOpenedPtr NoLocalFile() {
  mojom::LocalFileOpenedPtr result = mojom::LocalFileOpened::New();
  result->navigated = false;
  return result;
}

void WebDeckShell::OpenLocalFile(int32_t tab_id,
                                 OpenLocalFileCallback callback) {
  if (select_file_dialog_) {
    std::move(callback).Run(NoLocalFile());
    return;
  }
  BrowserWindowInterface* window = GetWindow();
  gfx::NativeWindow owner =
      window ? window->GetWindow()->GetNativeWindow() : gfx::NativeWindow();
  ui::SelectFileDialog::FileTypeInfo file_types;
  file_types.allowed_paths = ui::SelectFileDialog::FileTypeInfo::NATIVE_PATH;
  file_types.include_all_files = true;
  open_local_file_callback_ = std::move(callback);
  open_local_file_tab_ = tab_id;
  select_file_dialog_ = ui::SelectFileDialog::Create(
      this, std::make_unique<ChromeSelectFilePolicy>(shell_contents_));
  select_file_dialog_->SelectFile(ui::SelectFileDialog::SELECT_OPEN_FILE,
                                  u"Open File", base::FilePath(), &file_types,
                                  0, base::FilePath::StringType(), owner);
}


void WebDeckShell::FileSelected(const ui::SelectedFileInfo& file, int index) {
  select_file_dialog_ = nullptr;
  if (pick_image_callback_) {
    ReplyWithPickedImage(file.file_path);
    return;
  }
  if (open_local_file_callback_) {
    OpenPickedFile(file.file_path);
    return;
  }
  if (pick_paths_callback_) {
    std::move(pick_paths_callback_).Run({file.file_path.value()});
  }
}

void WebDeckShell::MultiFilesSelected(
    const std::vector<ui::SelectedFileInfo>& files) {
  select_file_dialog_ = nullptr;
  if (pick_image_callback_) {
    if (files.empty()) {
      std::move(pick_image_callback_).Run(std::string());
    } else {
      ReplyWithPickedImage(files.front().file_path);
    }
    return;
  }
  if (open_local_file_callback_) {
    if (files.empty()) {
      std::move(open_local_file_callback_).Run(NoLocalFile());
    } else {
      OpenPickedFile(files.front().file_path);
    }
    return;
  }
  std::vector<std::string> paths;
  paths.reserve(files.size());
  for (const ui::SelectedFileInfo& file : files) {
    paths.push_back(file.file_path.value());
  }
  if (pick_paths_callback_) {
    std::move(pick_paths_callback_).Run(std::move(paths));
  }
}

// Files dropped on this shell's window, on the tab strip or on a page.
//
// Chromium offers them here before doing its own thing with them. A file
// WebDeck reads — a document, or source — is taken, and handed to the shell as
// a signed path. Everything else is given back, and Chromium opens it exactly
// as it always would, which for a PDF means its own viewer in a tab.
std::vector<base::FilePath> WebDeckShell::OnFilesDropped(
    const std::vector<base::FilePath>& paths) {
  std::vector<mojom::SignedFilePtr> documents;
  std::vector<base::FilePath> unclaimed;
  for (const base::FilePath& path : paths) {
    mojom::SignedFilePtr signed_file =
        IsDocumentFile(path) ? SignForShell(path) : nullptr;
    // A document we cannot sign — the core is not up, so nothing could be
    // granted — goes back to Chromium rather than vanishing.
    if (signed_file) {
      documents.push_back(std::move(signed_file));
    } else {
      unclaimed.push_back(path);
    }
  }
  if (!documents.empty() && client_) {
    client_->OnDocumentsDropped(std::move(documents));
  }
  return unclaimed;
}

// One picked file, opened the way its kind deserves.
//
// A document is handed back as a signed path, because Chromium would show it
// as raw text or download it and WebDeck has a reader for it. Everything else
// navigates, which is what Chromium's viewers are for. Nothing is copied: the
// file opens where the user keeps it.
void WebDeckShell::OpenPickedFile(const base::FilePath& path) {
  mojom::LocalFileOpenedPtr result = mojom::LocalFileOpened::New();
  if (IsDocumentFile(path)) {
    result->document = SignForShell(path);
  }
  // Not a document, or the core is not up to grant it: show what Chromium can.
  if (!result->document) {
    result->navigated = NavigateToLocalFile(open_local_file_tab_, path);
  }
  std::move(open_local_file_callback_).Run(std::move(result));
}

void WebDeckShell::FileSelectionCanceled() {
  select_file_dialog_ = nullptr;
  if (pick_image_callback_) {
    std::move(pick_image_callback_).Run(std::string());
    return;
  }
  if (open_local_file_callback_) {
    std::move(open_local_file_callback_).Run(NoLocalFile());
    return;
  }
  if (pick_paths_callback_) {
    std::move(pick_paths_callback_).Run({});
  }
}

}  // namespace webdeck
