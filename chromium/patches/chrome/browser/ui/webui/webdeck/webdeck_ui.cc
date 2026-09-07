// Copyright 2026 Arcwel. All rights reserved.

#include "chrome/browser/ui/webui/webdeck/webdeck_ui.h"

#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/stringprintf.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/webui/favicon_source.h"
#include "chrome/browser/ui/webui/webdeck/webdeck_agent_tabs.h"
#include "chrome/browser/ui/webui/webdeck/webdeck_shell.h"
#include "chrome/browser/webdeck/webdeck_core_service.h"
#include "chrome/common/webui_url_constants.h"
#include "chrome/grit/webdeck_resources.h"
#include "chrome/grit/webdeck_resources_map.h"
#include "components/favicon_base/favicon_url_parser.h"
#include "content/public/browser/url_data_source.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/common/bindings_policy.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/webui/webui_util.h"

namespace {

// The one dynamic resource: the core's port, which is chosen at spawn time.
constexpr char kCorePortPath[] = "core-port.js";

bool ShouldHandleRequest(const std::string& path) {
  return path == kCorePortPath;
}

// One sequence for every call into the core service. The service is a
// singleton guarded by a SEQUENCE_CHECKER, and starting it does real file I/O
// (resolve the binary, make a runtime dir, spawn, wait for the port file), so
// all of it has to happen on the same MayBlock sequence — never on the UI
// thread, which forbids blocking outright.
scoped_refptr<base::SequencedTaskRunner> CoreTaskRunner() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
           base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN}));
  return *runner;
}

// Serves `window.WEBDECK_CORE_PORT = <n>;`. A generated script rather than
// loadTimeData: it is one integer, the page needs it before anything else, and
// this avoids depending on the strings.js/load_time_data module plumbing for a
// single value.
//
// Answered ASYNCHRONOUSLY. Starting the core blocks until it publishes its
// port, and the earlier version did that inline on the UI thread — which
// crashed the browser outright the moment chrome://webdeck was opened in a
// window (DCHECK: "Function marked as blocking was called from a scope that
// disallows blocking"). It did not reproduce headless, where that ban is not
// armed, so every headless check passed while the real thing died. The request
// filter hands us a callback precisely so the answer can arrive later: the wait
// now happens on the core sequence and the page's script request completes when
// the port is known.
void HandleRequest(const std::string& path,
                   content::WebUIDataSource::GotDataCallback callback) {
  CoreTaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE,
      base::BindOnce([]() -> std::pair<int, std::string> {
        webdeck::WebDeckCoreService* service =
            webdeck::WebDeckCoreService::GetInstance();
        service->EnsureStarted();
        return {service->port(), service->token()};
      }),
      base::BindOnce(
          [](content::WebUIDataSource::GotDataCallback cb,
             std::pair<int, std::string> handoff) {
            // The token is written through a JSON string writer, NOT
            // StringPrintf. It is base64url in practice and needs no escaping,
            // but this is script emitted into a privileged page from a file on
            // disk — a corrupt or hostile handoff must not be able to inject
            // into chrome://webdeck.
            const std::string token_literal =
                base::WriteJson(base::Value(handoff.second)).value_or("\"\"");
            std::string body =
                base::StringPrintf("window.WEBDECK_CORE_PORT = %d;\n"
                                   "window.WEBDECK_CORE_TOKEN = %s;\n",
                                   handoff.first, token_literal.c_str());
            std::move(cb).Run(
                base::MakeRefCounted<base::RefCountedString>(std::move(body)));
          },
          std::move(callback)));
}

}  // namespace

WebDeckUIConfig::WebDeckUIConfig()
    : DefaultWebUIConfig(content::kChromeUIScheme,
                         chrome::kChromeUIWebDeckHost) {}

WebDeckUIConfig::~WebDeckUIConfig() = default;

WebDeckUI::WebDeckUI(content::WebUI* web_ui) : WebUIController(web_ui) {
  // Grant the page Mojo, which is what puts the `Mojo` global in the frame.
  // Without it the generated bindings load fine and then fail on first use with
  // "Mojo is not defined" — the interface is registered, the page simply has no
  // way to speak to it. This is what lets the agent drive the user's own tabs.
  web_ui->SetBindings(
      content::BindingsPolicySet({content::BindingsPolicyValue::kMojoWebUi}));

  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      web_ui->GetWebContents()->GetBrowserContext(),
      chrome::kChromeUIWebDeckHost);

  // Standard WebUI setup: registers our resources, sets the default document,
  // and enables Trusted Types.
  webui::SetupWebUIDataSource(source, kWebdeckResources,
                              IDR_WEBDECK_INDEX_HTML);

  // Site icons for the start page, from Chromium's own favicon database:
  // chrome://favicon2/?pageUrl=… answers for every site the profile has
  // visited, the same source the new tab page and history use. The default
  // WebUI img-src already admits it, so the page needs nothing more than the
  // URL, and no icon ever comes from the network on the page's behalf.
  Profile* profile = Profile::FromWebUI(web_ui);
  content::URLDataSource::Add(
      profile, std::make_unique<FaviconSource>(
                   profile, chrome::FaviconUrlFormat::kFavicon2));

  // The core is started by the core-port.js handler, on a MayBlock sequence.
  // Starting it here would mean blocking the UI thread in a WebUI constructor,
  // which is what crashed the browser in a window.
  source->SetRequestFilter(base::BindRepeating(&ShouldHandleRequest),
                           base::BindRepeating(&HandleRequest));

  // MUST come after SetupWebUIDataSource: that helper sets its own connect-src,
  // which would otherwise block the loopback WebSocket this page exists to use.
  // The page may reach the core and chrome://resources, and nothing else — no
  // remote origin — so a compromised page cannot exfiltrate.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ConnectSrc,
      // data: is required by the VS Code service layer, which loads its
      // built-in extension manifests as data: URIs from the bundle.
      "connect-src chrome://resources ws://127.0.0.1:* ws://localhost:* "
      "data: 'self';");
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::FrameAncestors,
      "frame-ancestors 'none';");

  // The editor's TextMate tokenizer is oniguruma compiled to WebAssembly, and
  // the extension host runs extension code the same way. 'wasm-unsafe-eval'
  // permits WebAssembly.instantiate and nothing else — eval() and inline
  // script stay refused (verify-hardening measures both at runtime). The
  // sources are otherwise the WebUI default: this origin and chrome://resources.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ScriptSrc,
      "script-src chrome://resources 'self' 'wasm-unsafe-eval';");

  // Monaco (the editor) embeds its icon font as a data: URI.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::FontSrc,
      "font-src chrome://resources data: 'self';");

  // Monaco creates dozens of Trusted Types policies with names it derives at
  // runtime (editorViewLayer, diffEditorWidget, domLineBreaksComputer, …), so an
  // allowlist of names is not maintainable — it would break on every Monaco
  // upgrade. Allow any policy *name* while KEEPING require-trusted-types-for
  // 'script' from SetupWebUIDataSource: the sinks are still protected, we are
  // only declining to enumerate the policies. The page is entirely first-party
  // bundled code and loads nothing remote, so the residual risk is bounded.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::TrustedTypes, "trusted-types *;");

  // Reveal.js slide decks are served by a local HTTP server the core runs, and
  // the Preview block frames a workspace dev server the same way. Loopback only.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::FrameSrc,
      "frame-src http://127.0.0.1:* http://localhost:* 'self';");

  // Monaco's language and tokenizer workers are same-origin blobs.
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::WorkerSrc,
      "worker-src blob: 'self';");
}

WebDeckUI::~WebDeckUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(WebDeckUI)

void WebDeckUI::BindInterface(
    mojo::PendingReceiver<webdeck::mojom::AgentTabs> receiver) {
  // One implementation per page. Rebinding replaces it, which drops every tab
  // the previous page had attached — correct, because that page is gone and
  // its protocol sessions are no longer answerable.
  agent_tabs_ = std::make_unique<webdeck::WebDeckAgentTabs>(
      std::move(receiver),
      Profile::FromWebUI(web_ui()));
}

void WebDeckUI::BindInterface(
    mojo::PendingReceiver<webdeck::mojom::Shell> receiver) {
  // One implementation per page; rebinding replaces it. The shell's WebContents
  // (this WebUI's) carries a WebDeckShellHost naming the owning window, which is
  // how WebDeckShell reaches that window's tabs and contents view.
  shell_ = std::make_unique<webdeck::WebDeckShell>(web_ui()->GetWebContents(),
                                                   std::move(receiver));
}
