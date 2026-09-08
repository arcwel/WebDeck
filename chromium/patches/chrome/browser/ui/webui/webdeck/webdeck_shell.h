// Copyright 2026 Arcwel. All rights reserved.

#ifndef CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_SHELL_H_
#define CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_SHELL_H_

#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "chrome/browser/ui/webui/webdeck/webdeck.mojom.h"
#include "components/find_in_page/find_result_observer.h"
#include "content/public/browser/web_contents_observer.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "ui/shell_dialogs/select_file_dialog.h"

class BrowserWindowInterface;
class ContentsContainerView;
class Profile;
class TabStripModel;

namespace content {
class NavigationEntry;
class NavigationHandle;
class WebContents;
}

namespace find_in_page {
class FindTabHelper;
}

namespace webdeck {

// Browser-side impl of mojom::Shell — the WebDeck window's own chrome. It drives
// the real tabs in the window's TabStripModel and positions the active tab into
// the "stage" rect the shell (chrome://webdeck) streams, using the same
// contents-resizing strategy DevTools uses to place a docked inspected page.
//
// Owned by WebDeckUI (rebinding drops the old one). The shell's WebContents is
// hosted in the window's shell_web_view_ (not a tab); WebDeckShellHost on it
// names the owning window, which is how this reaches the TabStripModel and the
// ContentsContainerView.
class WebDeckShell : public mojom::Shell,
                     public TabStripModelObserver,
                     public content::WebContentsObserver,
                     public find_in_page::FindResultObserver,
                     public ui::SelectFileDialog::Listener {
 public:
  WebDeckShell(content::WebContents* shell_contents,
               mojo::PendingReceiver<mojom::Shell> receiver);
  ~WebDeckShell() override;

  WebDeckShell(const WebDeckShell&) = delete;
  WebDeckShell& operator=(const WebDeckShell&) = delete;

  // mojom::Shell:
  void SetStageBounds(const gfx::Rect& stage) override;
  void SetSplit(bool enabled,
                int32_t primary_tab_id,
                int32_t secondary_tab_id) override;
  void SetSecondaryStageBounds(const gfx::Rect& stage) override;
  void CreateTab(const std::string& url, CreateTabCallback callback) override;
  void SelectTab(int32_t tab_id) override;
  void CloseTab(int32_t tab_id) override;
  void Navigate(int32_t tab_id, const std::string& url) override;
  void Reload(int32_t tab_id) override;
  void GoBack(int32_t tab_id) override;
  void GoForward(int32_t tab_id) override;
  void Stop(int32_t tab_id) override;
  void SetStageCornerRadius(int32_t radius) override;
  void Find(int32_t tab_id,
            const std::string& query,
            bool forward) override;
  void StopFind(int32_t tab_id) override;
  void SetZoom(int32_t tab_id, double level, SetZoomCallback callback) override;
  void Print(int32_t tab_id) override;
  void OpenDevTools(int32_t tab_id) override;
  void TogglePictureInPicture(int32_t tab_id) override;
  void GetPageText(int32_t tab_id, GetPageTextCallback callback) override;
  void GetBlockThirdPartyCookies(
      GetBlockThirdPartyCookiesCallback callback) override;
  void SetBlockThirdPartyCookies(bool blocked) override;
  void GetSendDoNotTrack(GetSendDoNotTrackCallback callback) override;
  void SetSendDoNotTrack(bool enabled) override;
  void GetHttpsOnlyMode(GetHttpsOnlyModeCallback callback) override;
  void SetHttpsOnlyMode(bool enabled) override;
  void GetPreloadPages(GetPreloadPagesCallback callback) override;
  void SetPreloadPages(bool enabled) override;
  void GetAdblockEnabled(GetAdblockEnabledCallback callback) override;
  void SetAdblockEnabled(bool enabled) override;
  void GetAdblockBlockedCount(GetAdblockBlockedCountCallback callback) override;
  void ClearBrowsingData(bool cookies,
                         bool cache,
                         bool history,
                         int32_t time_range,
                         ClearBrowsingDataCallback callback) override;
  void GetDefaultBrowserState(GetDefaultBrowserStateCallback callback) override;
  void SetAsDefaultBrowser(SetAsDefaultBrowserCallback callback) override;
  void GetExtensionActions(int32_t tab_id,
                          GetExtensionActionsCallback callback) override;
  void RunExtensionAction(int32_t tab_id,
                          const std::string& extension_id,
                          RunExtensionActionCallback callback) override;
  // Opens `url` as a popup window sized like an extension popup.
  void ShowExtensionPopup(const GURL& url);
  void GetSettingPrefs(const std::vector<std::string>& names,
                       GetSettingPrefsCallback callback) override;
  void SetSettingPref(const std::string& name,
                      const std::string& json_value,
                      SetSettingPrefCallback callback) override;
  void GetAccountInfo(GetAccountInfoCallback callback) override;
  void SetClient(mojo::PendingRemote<mojom::ShellClient> client) override;
  void SetStageVisible(bool visible) override;
  void CaptureStage(int32_t tab_id, CaptureStageCallback callback) override;
  void OpenWindow(const std::string& url, OpenWindowCallback callback) override;
  void FocusWindow(int32_t window_id) override;
  void CloseWindow(int32_t window_id) override;
  void PickPaths(int32_t mode, PickPathsCallback callback) override;
  void OpenLocalFile(int32_t tab_id, OpenLocalFileCallback callback) override;

  // Files were dropped on this shell's window, on the tab strip or on a page
  // (both of Chromium's drop paths ask, via webdeck_shell_host). Returns the
  // paths the shell did NOT take, for Chromium to open as it normally would.
  std::vector<base::FilePath> OnFilesDropped(
      const std::vector<base::FilePath>& paths);

  // ui::SelectFileDialog::Listener: the PickPaths panel answered.
  void FileSelected(const ui::SelectedFileInfo& file, int index) override;
  void MultiFilesSelected(
      const std::vector<ui::SelectedFileInfo>& files) override;
  void FileSelectionCanceled() override;

  // TabStripModelObserver: the active tab changed (or the set of tabs did), so
  // re-observe the active tab and push its state to the shell.
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;

  // content::WebContentsObserver (of the active tab): its navigation state
  // changed, so push it to the shell's address bar / nav buttons.
  void DidFinishNavigation(
      content::NavigationHandle* navigation_handle) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void TitleWasSet(content::NavigationEntry* entry) override;

  // find_in_page::FindResultObserver: a find-in-page result is available for
  // `web_contents`, so push its active/total match counts to the shell.
  void OnFindResultAvailable(content::WebContents* web_contents) override;
  void OnFindTabHelperDestroyed(
      find_in_page::FindTabHelper* helper) override;

 private:
  // The window that owns the shell; null if it (or the host link) has gone away.
  BrowserWindowInterface* GetWindow();
  // The active ContentsContainerView of the owning window, or null.
  ContentsContainerView* GetContentsContainerView();
  // The WebContents of the tab addressed by `tab_id`, or null if it is gone or
  // does not belong to this window.
  content::WebContents* GetTabById(int32_t tab_id);
  // The Profile that owns the shell page — the target of every browser-pref
  // read/write. Null only if the shell's WebContents has no browser context.
  Profile* GetProfile();

  // Start observing the window's TabStripModel + its active tab, and push an
  // initial snapshot. Called when the shell registers its client.
  void StartObserving();
  // Re-point the WebContentsObserver (and the find-result observer) at the
  // currently active tab.
  void ObserveActiveTab();
  // Push the active tab's navigation state to the shell (no-op if no client).
  void PushActiveTabState();
  // Push the full tab list + active tab id to the shell (no-op if no client).
  void PushTabList();
  // A browser command (IDC_*) for this window: true if the shell owns it and
  // it was sent to the client as ShellClient.OnCommand; false to let Chromium
  // handle it. Registered with the window via webdeck::SetCommandForwarder.
  // With `execute` false only answers whether the shell owns the command.
  bool ForwardCommand(int command_id, bool execute);

  const raw_ptr<content::WebContents> shell_contents_;
  mojo::Receiver<mojom::Shell> receiver_;
  mojo::Remote<mojom::ShellClient> client_;
  // The TabStripModel this observes, so the observer is removed in the dtor.
  raw_ptr<TabStripModel> observed_model_ = nullptr;
  // The active tab's FindTabHelper this is registered on as a
  // FindResultObserver, so it can be removed when re-pointing / in the dtor.
  raw_ptr<find_in_page::FindTabHelper> observed_find_helper_ = nullptr;
  // The tab staged in the secondary split pane (a TabHandle raw value), or 0
  // when not splitting. Tracked so its removal can defensively tear the split
  // down (OnTabStripModelChanged kRemoved) even if the renderer never calls
  // SetSplit(false).
  int32_t secondary_tab_id_ = 0;
  // The open PickPaths panel and the reply it owes. One at a time: a second
  // PickPaths while this is set answers empty at once.
  scoped_refptr<ui::SelectFileDialog> select_file_dialog_;
  // Set while the open panel is being used to open a file in a tab rather than
  // to return paths to the page. The two share one dialog, so the completion
  // handlers branch on which of these is pending.
  // Navigate `tab_id` to a local file the BROWSER resolved. Returns false
  // when the tab is gone or the path is not a file URL.
  bool NavigateToLocalFile(int32_t tab_id, const base::FilePath& path);

  // One picked file, routed to the viewer that suits it; and the reply once a
  // document has been copied into the staging area off the UI thread.
  void OpenPickedFile(const base::FilePath& path);

  OpenLocalFileCallback open_local_file_callback_;
  int32_t open_local_file_tab_ = 0;
  PickPathsCallback pick_paths_callback_;
  // The window this registered a command forwarder with, so the destructor
  // clears exactly that registration.
  raw_ptr<BrowserWindowInterface> forwarding_window_ = nullptr;
  base::WeakPtrFactory<WebDeckShell> weak_factory_{this};
};

}  // namespace webdeck

#endif  // CHROME_BROWSER_UI_WEBUI_WEBDECK_WEBDECK_SHELL_H_
