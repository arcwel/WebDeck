# WebDeck owns the window — shell architecture

> Goal: the forked browser is no longer stock Chrome. The **WebDeck React shell**
> (glass tab strip, toolbar, summonable Dev Deck, Stage reveal) draws the window,
> and real web pages render as **native `WebContents`** the shell positions —
> mirroring the Electron `WebContentsView` + `setBounds` model that DESIGN.md was
> written against.

This is the faithful path chosen over a native-Chrome skin. It reuses the entire
existing React shell in `app/src/renderer`; the work is a Chromium integration
layer plus re-pointing the shell's host bridge from Electron IPC to Mojo.

## The prior art: DevTools

Chromium already ships exactly this pattern. `chrome-devtools://devtools/...` is a
**WebUI** that, when docked, does not overlap the inspected page — instead the
inspected page's native `WebContents` view is **resized and repositioned** to sit
beside the front-end, and the front-end drives that split by sending pixel bounds
to the browser. The machinery:

- `DevToolsWindow` hosts the front-end `WebContents` in a `views::WebView`.
- `DevToolsContentsResizingStrategy` + `SetContentsResizingStrategy(...)` take the
  bounds the WebUI computed in JS and apply them to the inspected contents view.
- The front-end calls `setInspectedPageBounds({x,y,width,height})`; it crosses to
  C++ via the embedder message channel and moves the native view every frame.

WebDeck's "stage" is the same idea generalized: the shell computes the stage
placeholder's rect with a `ResizeObserver` and streams it to C++, which sizes the
active tab's native view to match. The Stage reveal is then just the shell
animating that rect (page scales into a spotlit frame) while the native view
follows — identical in spirit to DESIGN.md's implementation note (§ Implementation
notes: "the existing ResizeObserver → `setBounds` pipe streams bounds to the native
view each frame").

## Target architecture

```
WebDeck browser window
├── views::WebView  →  chrome://webdeck  (the React shell: fills the window)
│      draws: glass tab strip · toolbar · Dev Deck · STAGE PLACEHOLDER (a hole)
└── views::WebView(s)  →  the actual browser tabs (real WebContents)
       overlaid above the shell, each sized/clipped to the stage-placeholder rect
       the shell streams over Mojo; only the active tab's view is visible.
```

- **No native Chrome tab strip / toolbar.** The window is a WebDeck-flavoured
  frame; the shell owns all chrome. (`host.ownsBrowserChrome = true` on the fork —
  the flag already gates this in `App.tsx`.)
- **Tabs are real `WebContents`**, not `<webview>`/iframes — full browser fidelity
  (process isolation, extensions, devtools, permissions), unlike an app-window
  `<webview>` approach.
- **The shell drives everything over Mojo.** One interface (extend the existing
  `webdeck.mojom`, which already carries `AgentTabs`): create/select/close/navigate
  tabs, receive per-tab navigation state, stream the stage rect, route
  new-window→new-tab, presets, etc.

## Why not the alternatives

- **`<webview>` inside an app-mode WebUI** — simpler to position, but guest views
  are second-class: weaker process model, missing extension/devtools/permission
  surfaces, and a maintenance cliff. WebDeck is a _browser_; its tabs must be real.
- **Rewriting `BrowserView`/`TabStripModel` wholesale** — unnecessary. We keep
  Chromium's `Browser`/`TabStripModel` as the tab backend and add a WebDeck window
  presentation on top (the DevTools pattern proves a WebUI can own the layout
  without replacing the tab model).

## Phases

Each phase is independently verifiable; relinks are called out (each ~1 h).

1. **Spike / design (no relink).** Nail the minimal patch surface against the M153
   tree: how to (a) present a browser window whose contents are the WebDeck WebUI
   with native top-chrome hidden, and (b) overlay a native tab `WebContents` view
   positioned by bounds the WebUI streams (DevTools resizing strategy as the
   model). Output: the concrete class/file list and the mojom shape. → this doc's
   companion `SHELL_SPIKE.md`.
2. **Mojo shell interface (relink).** Grow `webdeck.mojom` from AgentTabs into the
   full shell bridge: `Shell` (tab lifecycle + navigation state + stage bounds).
3. **Native presentation (relink).** WebDeck window/view that hosts the shell WebUI
   and the overlaid, bounds-driven tab view; wire the mojom to `TabStripModel` and
   to a contents-resizing strategy.
4. **Renderer host bridge (no relink, parallel with 2–3).** Reimplement
   `window.agweb.*` on the Mojo interface; flip `ownsBrowserChrome`; wire
   TabStrip/Toolbar/Stage to real tabs; port the ResizeObserver → stage-bounds pipe.
5. **Stage reveal + presets (no relink).** The signature animation on real bounds;
   layout presets; per-project persistence. Detached IDE window is a later phase.

## Host-bridge surface (Phase 4 checklist)

The React shell talks to its host through `window.agweb.*`. On the fork,
`app/src/webui/ipc-adapter.ts` already routes dev features (fs, terminal, agents,
git, lsp) to `webdeck-core` over a WebSocket, and **stubs** the browser-owned
channels because today Chrome owns the chrome. Flipping to "WebDeck owns the
window" means giving those stubs a real Mojo-backed implementation. The shell's
`browser.*` surface maps almost 1:1 onto the DevTools/tab model — and critically,
**the shell already streams the stage rect**: `Stage` calls `browser.setBounds`

- `browser.setCornerRadius` every frame via its ResizeObserver, exactly the
  Electron `WebContentsView` pipe. So the renderer barely changes; it just needs the
  host bridge pointed at Mojo.

| Shell call (`window.agweb.browser.*`)                       | Mojo Shell method      | Notes                                                                                                                                 |
| :---------------------------------------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `create(url)`                                               | `CreateTab`            | → `TabStripModel` add                                                                                                                 |
| `destroy(id)`                                               | `CloseTab`             |                                                                                                                                       |
| `navigate(id,url)` / `reload` / `stop` / `back` / `forward` | nav controls           |                                                                                                                                       |
| `setBounds(id,rect)`                                        | **`SetStageBounds`**   | the stage rect — DevTools `setInspectedPageBounds` analog                                                                             |
| `setCornerRadius(r)`                                        | `SetStageCornerRadius` | the Stage-reveal rounded frame                                                                                                        |
| `setVisible(id,bool)`                                       | `SetStageVisible`      | hidden while a shell overlay covers the stage; the split secondary follows                                                            |
| `captureStage(id)`                                          | `CaptureStage`         | a still of the page (JPEG data: URL) the stage shows in the view's place while it is hidden — the page never goes blank behind a menu |
| `onState(cb)`                                               | observer → renderer    | url/title/canGoBack/Forward/loading/favicon                                                                                           |
| `onOpenTab` / `onAdoptTab` / `onOpenDoc`                    | observer → renderer    | new-window→tab, doc routing                                                                                                           |
| `find` / `findStop` / `onFindResult`                        | find-in-page           | Chromium find controller                                                                                                              |
| `zoom` / `print` / `openDevTools`                           | passthrough            | Chromium built-ins                                                                                                                    |

`windows.*` (newWindow, openDeck/closeDeck/focusDeck, state sync) backs the
detached-IDE-window phase; not needed for the first single-window milestone.

Seed on the renderer: `app/src/webui/agent-tabs.ts` already binds a Mojo remote
(`AgentTabs`) and forwards events — the `Shell` bridge extends this file's pattern.

## Invariants to keep

- The release build still passes the deliverable checks (core starts from inside
  the bundle; `codesign --deep --strict`). The shell work must not regress §3 of
  RELEASING.md.
- Security posture from the pen-test pass holds: the Mojo shell interface keeps a
  method allowlist and loopback/no-debug-port stance; no new ungated navigation.
- `checkpoint/deliverable-chrome-shell` is the known-good fallback.

## Progress

- **Relink 1 — DONE** (`checkpoint/webdeck-owns-window`, commit b264e80). `--webdeck`
  opens a window where `chrome://webdeck` fills the frame with no native tab strip /
  toolbar / location bar / bookmark bar. Component build (`out/webdeck`) verified.
  Two non-obvious things future relinks must respect:
  - **`BrowserOpenBehavior::NEW`.** A fresh macOS profile takes the
    `SYNCHRONOUS_RESTORE` path, where `SessionRestore` builds the window and
    `OpenTabsInBrowser` is never reached. `--webdeck` forces `NEW` so tab steering
    and `is_webdeck_window` actually apply.
  - **The glass-layout CHECK.** `browser_view_tabbed_layout_impl.cc` asserts the
    toolbar has a `CustomCornersBackground`; a suppressed toolbar has none and it
    FATAL-crashed the window at creation. Fixed by a null-safe skip. Expect more
    "layout assumes chrome exists" spots as the window does more — fix them the
    same way (guard, don't force the chrome to exist).
- **2a — DONE** (`077d0e3`). Native overlay: a `shell_web_view_` in
  `ContentsContainerView` hosts `chrome://webdeck` beneath the active tab, which is
  positioned into an inset "stage" — a real page composited over the shell. No
  separate window-controller was needed: the container ctor has the profile, so it
  builds the shell view itself. A `WebDeckShellHost` (WebContentsUserData) links the
  shell's non-tab WebContents back to its window.
- **2b — DONE** (`674d7c9`). Mojo `Shell` backend: `SetStageBounds` →
  `SetContentsResizingStrategy` (the DevTools mechanism), tab lifecycle over
  `TabStripModel` keyed by stable `TabHandle`, reachable only from chrome://webdeck.
- **2c — DONE** (`75afd10`). The shell drives the window: `ownsBrowserChrome=false`
  so the glass tab strip/toolbar/Stage render; `browser.*` routed through the Shell
  bridge (`webui/shell.ts`); the staged tab is the active `TabStripModel` tab
  (`tab_id 0`). Verified functionally (the Stage streams `setBounds` with zero
  bridge rejections).
- **Nav-state — DONE** (`989b0d3`). `WebDeckShell` is a `TabStripModelObserver` +
  `WebContentsObserver`; pushes `TabInfo` to the shell via `ShellClient` so the
  address bar / nav buttons reflect the real URL. Renderer binds a
  `ShellClientReceiver` and delivers `BrowserTabState` over a local event bus.
- **Hardening — DONE** (in `75afd10` + `989b0d3`, from the review swarm). Scheme
  allowlist on `Navigate` + `CreateTab` (no silent `file://`/`chrome://`); one
  shell per window (`is_primary`, not the double shell `MultiContentsView` caused);
  `verify-hardening.mjs --static-only` guards the Shell boundary in CI.

### The renderer contract, corrected

The `browser.*` table above (§ Host-bridge surface) was written from the DevTools
single-stage model. The **actual shell** is an Electron-style multi-view host
keyed by the shell's own string ids. 2c wires the **primary case** — one staged
(active) tab — via a renderer shim onto the Shell backend (string id → the active
tab; `tab_id 0` = active). Split view, per-tab `setVisible`, and `setCornerRadius`
are the shell's multi-view features layered on next; they are documented no-ops in
`shell.ts` today.

### Deferred follow-ups (tracked, not test-build blockers)

- **Security indicator** for a public release — `TabInfo` carries no cert/HTTPS
  state and a WebDeck window has no native omnibox; a shipping browser needs an
  unspoofable trust badge.
- **Docked DevTools in a WebDeck window** shares `ContentsContainerView::strategy_`
  with the stage — disable docked DevTools for `is_webdeck_window`, or give the
  stage its own slot.
- **`CreateTab` failure sentinel** — `0` doubles as "failed" and "active tab".
- **Split view / multi-tab switching / corner radius** — the shell's multi-view
  features on top of the same Shell interface.

- **Release build — IN PROGRESS.** `out/webdeck-release` (official, non-component)
  building all the shell work for the first deliverable DMG; then install:core →
  verify:deliverable → package:fork. Notarization stays the user's [YOU] step.
