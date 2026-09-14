# Changelog

All notable changes to Arcwel WebDeck are recorded here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

## v0.1.5 — 2026-09-14

### Fixed (a download that goes quiet is given up)

- **Update now no longer sits at "Downloading…" for as long as a stalled
  socket stays open.** A transfer that delivers nothing for sixty seconds is
  given up and says so; the checksum fetch has a timeout of its own; the
  archive is written through a larger buffer so a fast link is not paced by
  thousands of small drains.

## v0.1.4 — 2026-09-14

### Fixed (macOS privacy strings)

- **The app no longer dies the first time a page touches Bluetooth, the
  camera, the microphone, location or the local network.** macOS terminates a
  process outright — no dialog, no log line — when it reaches a privacy-gated
  service whose usage string is missing from Info.plist, and the open-source
  Chromium template ships none (Google adds them only in its branded build).
  A page asking about Bluetooth availability took a whole session down. The
  fork's Info.plist now carries the eight usage strings, each naming Arcwel
  WebDeck and saying the service is only used for sites you allow, so macOS
  asks instead of killing. The packager refuses to package a bundle missing
  any of them.

## v0.1.3 — 2026-09-07

### Fixed (a verified update opens)

- **A build fetched by Update now opens without the Open Anyway step.** The
  browser asks the kernel to quarantine every file its processes write, the
  core included, so the downloaded archive and everything unpacked from it
  carried the flag that makes Gatekeeper refuse a build that is not
  notarized. The updater now clears it after the bytes have matched the
  release's published digest — that check is the vouching the flag asks for.
  The packager also clears it from the staged app before zipping.

### Added (Update now)

- **Update now fetches the new build for you.** The Update panel's Update now
  downloads the release's build for this Mac into Downloads, checks its size
  and its published SHA-256, unpacks the zip beside itself and shows the app
  in Finder — installing is a drag to Applications and a relaunch. Progress,
  cancel, and a plain reason when something goes wrong. A release with no
  build attached still offers the release page.
- `package-fork` now writes the release archive beside the disk image:
  `Arcwel-WebDeck-<version>-arm64.zip` (ditto, so the signature's attributes
  survive) and a `SHA256SUMS`. Both go up as release assets; the checker picks
  the zip for this architecture and verifies against the sums.

### Added (release checks)

- **WebDeck checks for a newer release on launch and once a day.** The core
  reads the repository's releases, keeps to this build's channel — a stable
  build hears about stable releases only, a pre-release build about both —
  and, when one is newer, an **Update** chip appears beside Ask. It opens a
  small panel with the version, the notes and two choices: open the release
  page, or not now (which keeps the chip down until a newer release appears).
  Nothing downloads on its own. Settings → Application → About shows what the
  checker last found, why a check failed, and a **Check now** button.
  `WEBDECK_UPDATE_FEED` points a staged build at another feed;
  `WEBDECK_UPDATE_CHECK=off` turns the schedule off.
- The core's version is stamped from `package.json` at build time
  (`WEBDECK_VERSION` still overrides it), so About and the checker agree.

### Fixed (QA pass over local models)

- A local model's failures are said in a sentence: a runtime that is not
  answering names its endpoint and how to start it, an answer cut off
  mid-stream says so, and a plan that stalls is bounded instead of spinning.
- A tool call whose arguments the model garbled is refused and ends the turn,
  rather than running the tool with an empty input. A model's plan goes through
  the same bounds as a user's edit of it. A cloud id the build does not offer
  is refused, and the composer's fallback list names the real Haiku id.
- A model whose capability probe failed is still offered (as able to call
  tools) and probed again on the next look, instead of being hidden or marked
  incapable for the cache window. A settings file that cannot be read is
  reported rather than silently replaced by defaults.

### Fixed (menus never blank the page)

- **Opening a menu no longer blanks the page.** The native page view paints
  above the shell's DOM, so a menu that overlaps the page can only show once
  the view hides — and hiding it left the page blank behind every menu, even a
  picker in the dock that never touched the page. Now a popover registers as
  an overlay only while some part of it actually lies over the stage
  (re-checked as it resizes), so a menu inside a block or the dock leaves the
  page live. When an overlay does cover the page — a top-bar menu, the
  omnibox dropdown, the palette, Settings — the stage first takes a still of
  the page (a new `Shell.CaptureStage`, copied from the compositor surface
  and JPEG-encoded off the UI thread), paints it in the view's place, and only
  then hides the view; the still lingers for a beat when the view returns.
  In split view only the primary stage is copied. The Deck's resize handles
  are hidden while the Deck is folded, so they cannot show through the still.

### Added (local models)

- **The agent and Ask can run on a model on this Mac.** Every model call now
  goes through one seam with two providers behind it: Claude through the
  Anthropic SDK, unchanged and still the reference, and Ollama through its own
  API. Settings → AI → _On this Mac_ shows whether Ollama is installed and
  answering, starts it, lists the models it holds with the capabilities the
  runtime reports (tools, thinking, vision, context size), and lets each be
  chosen for the agent or for Ask. The composer's model picker groups Cloud
  and On this Mac, with a blue dot for a model that runs here.
- Model ids are provider-qualified (`anthropic/claude-opus-5`,
  `ollama/qwen3.5:9b`). A local choice is per machine and never syncs; the
  cloud choice still does. A model that cannot call tools may answer Ask but is
  refused for the agent, with the reason. The Agents block's banner follows
  the choice. A local model is offered a smaller
  tool set, and its plan is JSON shaped by the plan schema, checked and
  retried once.

### Added (start page, Deck presets, one surface at a time)

- **The start page shows real site icons**, from the profile's own favicon
  database through Chromium's `chrome://favicon2` source, registered for the
  page. No icon ever comes from the network on the page's behalf.
- **You choose the sites on the start page.** Hover a tile to hide it or unpin
  it, add one with the + tile, and see and undo every pin and hidden site under
  Settings → WebDeck → Start page. Pins come first, the most visited fill the
  rest, and the choice is kept per profile.
- **The Debugging preset is its own arrangement**: files in the left column,
  the debugger beside the editor, and the bottom dock as evidence — logs first
  and on their own, then the terminal, then the agent. It used to be Building
  with a logs tab.
- **The Ask panel and the Dev Deck no longer share a window.** Opening Ask
  folds an attached Deck away, and the Deck coming forward — ⌘D, a preset, a
  file opening into the editor — closes Ask. A Deck popped out into its own
  window and Ask coexist.
- **Each bottom corner of the Deck has an owner you choose.** By default the
  dock runs the full width, so the dead square under the left column is gone.
  A toggle at each junction lets that column stand full height beside the dock
  instead, set per side, so a tall file tree and a wide log can coexist.
- **Every Deck zone resizes by dragging its edge**, not only the bottom dock.
  The side handles were positioned inside the stage, where the page's native
  view covers them, so they could only be grabbed over the start page. Each
  handle now sits in the gutter beside its zone, is faintly visible at rest,
  and never overlaps the stage.
- A plan for running the agent and Ask on a local model — Ollama first, then
  any OpenAI-compatible server — behind a provider seam that keeps Claude as
  the reference: `docs/local-llm-plan.md`.
- A plan for tabs from other devices and sending links and files between
  them, on the sync service that exists and an Iroh-based transport after
  DashBeam's design: `docs/device-sync-plan.md`.

### Fixed (file drops, editor boot, local test builds)

- **Dropping a file on the page now opens it.** The shell claimed dropped
  documents and then never heard about them: the event was emitted on the
  shell's own bus while the page's listener had been wired to the core socket,
  because the channel was missing from the routing set. A test now reads the
  shell source and checks every emitted channel against that set.
- **Drops are caught on both of Chromium's paths.** A drop on the tab strip is
  the window's; a drop on the page is the page's, and the page's path had no
  hook at all. Both now offer the files to the shell first. On the shell page,
  whatever the shell hands back opens as a new tab instead of being refused,
  so a PDF dropped on the page opens in Chromium's viewer.
- **Source files open in Document Studio's source view** — Python, JavaScript,
  Go, Rust, shell, SQL, CSS, plain text and some forty more — with _Open in
  Editor_ for the Deck. Nothing opens Deck blocks on its own.
- **The view follows the file**: on a change inside the open project, right
  after each save from the editor, and every 30 seconds for a file outside any
  project.
- **Files opened from outside a project come back after a relaunch.** Their
  tabs were restored but the files were not readable. The core now remembers
  files the user opened by drop or pick and grants them again at startup while
  they exist; a missing file is forgotten. Folders stay session-only.
- **Every editor was blank when the core started slowly.** The editor's boot
  read settings through the shell API before the page had installed it, and a
  lost race left every editor dead for the session with one console line. The
  boot now waits for the API.
- **No more login-password prompt on every rebuild of a local build.**
  `npm run dev:signing-identity` makes a stable self-signed identity in its own
  keychain, `package-fork` accepts it, and with `webdeck_dev_keychain = true`
  the cookie key never touches the login keychain. Neither is for a release.
- Every drop leaves a line in `~/.webdeck/drops.log`, the one record that
  survives a Finder launch.
- **Mermaid diagrams render again.** The page requires Trusted Types for every
  HTML sink and the diagram was inserted as an HTML string, which the policy
  refuses; mermaid's own render also writes markup into a scratch element. The
  page's policy now lets an HTML string through only while a diagram is
  rendering; the result is parsed by an inert parser through a policy of its
  own, scrubbed of anything that could run (scripts, handler attributes,
  `javascript:` links, embedded frames), and inserted as nodes. Every other
  HTML string is still refused, and a diagram that fails says so in the
  console instead of silently showing its fence text.
- Removed the open-document event channel, a listener nothing had emitted
  since the Electron shell.

### Added (sync service, identity, history import)

- **Import browsing history from the browsers already on this machine.**
  Settings, WebDeck, Application lists every profile it finds with a page count
  and an Import button. Chrome, Edge, Brave, Vivaldi, Opera, Arc, Chromium,
  Firefox and Safari. Re-importing the same browser adds nothing rather than
  doubling what is there.
- **A sync service that speaks Chromium's own sync protocol** (`sync/`), so two
  WebDeck installs can share data without Google. Commit and GetUpdates, per
  account storage, progress markers, tombstones and store birthdays, over
  Chromium's own `.proto` files vendored from the checkout.
- **The identity endpoints to go with it.** Token exchange, user info, token
  info, revoke, ListAccounts and the connection check, plus a command that
  writes the `--gaia-config` file pointing a browser at them.
- `webdeck-sync` runs and inspects both: `serve`, `status`, `account`, `config`,
  `reset` and `datatypes`, each with `--json` and a real exit code.

  Signing in to Google remains impossible in a fork, and that is Google's
  restriction rather than a gap here — which is why both halves are ours.

### Added (drops, profile picture, tab groups)

- **Drag a PDF into the window and it previews in Chromium's PDF viewer**, with
  its annotation, text and print tools. A dropped file is staged in its own
  folder under the core's data directory and opened there by name, so the file
  keeps the name you dropped and the page never learns a path.
- **Pick your own profile picture.** Any image, centre-cropped and stored as a
  128px PNG in the app settings. This build cannot sign in to Google, so a
  photo was never going to arrive on its own.
- **Tab groups can be renamed, and a group can be given new tabs.** The group
  menu now offers Rename, "New tab in this group", a colour row and Ungroup,
  and it floats above the strip instead of being clipped by it.
- Roadmap: building our own sync service against Chromium's sync protocol and
  pointing the browser at it (B2b).

### Changed (documents open in Document Studio)

- **A dropped document opens in Document Studio, not in the browser.** Chromium
  has no reader for these: markdown and JSON came out as raw text in a `<pre>`,
  and CSV and YAML were not displayed at all, they were downloaded. Markdown,
  JSON, YAML, TOML, CSV, TSV, XML and SVG now open in the reader that was
  already there, with its styled view, source toggle, themes, conversion and
  export. PDF, images, HTML and plain text still go to Chromium, which renders
  them properly.
- A dropped document is granted to the file layer one file at a time, so the
  reader can open it with no project open. Grants last the session and are
  re-established at startup for documents still staged.
- The styled reader shows list markers again. Tailwind's preflight strips them
  from every list, which is right for the app's menus and wrong for a rendered
  document.
- Dropping a document no longer leaves an empty tab behind. The tab is minted
  once the file's kind is known, rather than before.

### Fixed (drops, blank tabs)

- **A dropped file opened an error page instead of the file.** The core staged
  it under its own data directory while the browser looked for it under the
  Chromium profile — two different places. The browser now resolves that
  directory once and hands the same path to the core, so both agree.
- **Blank tabs are dropped on restore**, and the window no longer gains an
  extra "about:blank" tab every time a session is restored. A restored session
  opens a page the moment the strip is rebuilt, which used to beat the
  browser's first tab push: the window's seed tab was missed, a second real
  tab was opened, and the seed was adopted as a phantom. A tab creation now
  waits to learn what tabs the window already has.
- A failed drop no longer strands its tab. The tab is opened before the browser
  is asked to load into it, and a browser that cannot be reached throws — which
  escaped the cleanup and left an empty tab with no explanation.
- The shell says so in the console when the browser does not push its tab list
  in time, instead of silently opening the extra blank tab that wait exists to
  prevent.

### Fixed (RC1 review)

- App icon: the bundle's asset catalog (Assets.car) is now WebDeck's, so Finder
  and the Dock show the WebDeck icon instead of Chromium's.
- Tabs sit inline with the window's traffic lights (the title bar is exactly the
  tab row's height); deck and float windows reserve the same inset.
- Popovers (favourites, extensions, profile) float above the page with a gap;
  the staged tab hides while any shell overlay is open.
- The agent's paperclip opens the native open panel and the attachment appears
  as a chip; the core creates the attachments folder on first use.
- Profile and settings entries open Sign in, Profiles, Browser settings and
  Extensions as real tabs.
- The Deck detaches into its own window and docks back; stacks float into real
  windows.
- The address bar and tab titles follow navigation again. The shell opened two
  Mojo pipes to the browser at startup (the client registration and the first
  tab creation raced); the browser keeps one Shell per page, so the client's
  pipe closed silently and no navigation state ever reached the tab strip. The
  remote is now resolved once, and a failed client registration is logged.
- The window's seed tab (the blank tab Chromium opens every window with) is no
  longer adopted as a phantom "about:blank" tab; the shell's first tab claims
  it instead of opening a second real tab.
- Closing the window's last real tab (a project switch restores a layout and
  destroys every content tab) empties the tab instead of letting Chromium
  close the window.

### Changed

- **Tabs belong to the browser, not the project.** The tab strip used to be
  saved and restored per workspace, so opening a project swapped in that
  project's old tabs and tore down the pages you were reading. One tab session
  per profile now, restored once at launch; a project switch only restores
  the Deck layout.
- **Cast / media routing is off by default.** Its mDNS discovery started at
  launch and raised macOS's "find devices on local networks" prompt before
  the user had done anything. The macOS permission text now names Arcwel
  WebDeck.

### Fixed (settings QA round)

- **The Application tab's "Clear now" did nothing.** Its channel has no handler
  on the fork, so the button raised "no handler for app-settings:clear-data"
  and cleared nothing — and the call had no error path, so the failure was
  invisible. Chromium's own remover on the Browser tab is the real one; the
  Application tab now points at it and at the Chromium pages that own site
  permissions, languages, hardware acceleration and Do Not Track.
- **Four toggles that changed nothing are gone.** Hardware acceleration, ask
  before granting page permissions, spell-check and Do Not Track wrote
  WebDeck's own settings file, which nothing on this build reads; Do Not Track
  also contradicted the working switch on the Browser tab. Chromium owns all
  four, so the panel names where each lives instead.
- **Failures no longer pass silently.** Saving an application setting, choosing
  the agent model and every sync action caught nothing: a rejected call left a
  control snapped back or a button quietly re-enabled with no message. Each
  reports now, and the model dropdown reverts rather than showing a model that
  was never saved.
- Settings is a real dialog: `role="dialog"`, an accessible name, and focus
  moves into the sheet when it opens. The colour channel inputs are named
  apart, the reset button is visible when focused rather than only on hover,
  and the decorative field swatch is out of the tab order.
- The About panel no longer lists an Electron version this build does not have,
  and the clear-data checkbox labelled "Auth cache" says what it clears.

### Fixed (profile picture and Google sign-in)

- **The profile button shows a picture again.** It only ever drew the Google
  account image, and this build can never have one, so it drew nothing. It now
  falls back to the local profile avatar — the picture
  chrome://settings/manageProfile sets — and still prefers the Google image
  where there is one.
- **The menu says why the browser is not signed in.** Signing in to a Google
  website does not sign in the browser: that needs Google's own API keys and
  OAuth client, which are issued to official Chrome builds only. Without them
  the identity manager holds no account, which is why the avatar was blank and
  Sync never started — the profile on this machine had zero browser accounts
  recorded despite being signed in on google.com. The browser now reports
  whether sign-in is possible at all, and the profile menu and the Sync row in
  settings say so instead of offering a flow that cannot complete.

### Fixed (block drop targets)

- **The drop zones open while a block is in the air.** An empty zone rests as
  a 10px strip, which is a fine resting state and a poor target: the cursor is
  carrying a block, the pointer is not where the eye is, and a miss drops the
  block back where it started. During a drag the left column and the bottom
  dock each open to a 96px band and all three zones show a dashed edge, so
  every target is both aimable and visible. The bands are overlays — the
  stage's insets come from inline custom properties that are left alone, so
  nothing reflows and the page does not jump under the drag. They close on
  `dragend`, which fires whether the block was dropped or abandoned.

### Changed (assistant panel and one settings sheet)

- **Ask opens a side panel, not the Dev Deck.** The assistant is its own
  layout: a panel beside the page, full height, with the Deck's zones and the
  stage inset by its width so nothing is drawn over anything. Toggling the
  Deck neither opens nor closes it. Asking about a page should not drag the
  editor, terminal and file tree on screen with it.
- **The Ask button is pinned to the top right** of the window rather than
  sitting at the end of the tab strip, where enough open tabs scrolled it out
  of reach.
- **Ask can be turned off** in Settings → WebDeck → Application.
- **One settings sheet with a Browser / WebDeck switch.** Settings used to be
  two surfaces reached from two menus: closing ours left a chrome:// settings
  tab behind it, and nothing said which was which. There is now one sheet —
  Browser is Chromium's settings, WebDeck is the application's — and the
  profile menu's duplicate entry is gone. The app menu's Settings item and its
  Command-comma accelerator are forwarded to the same sheet, so every route
  lands in one place.
- The agent has one live surface at a time: a Deck agents block says where the
  conversation went while the panel holds it, rather than rendering a second
  composer over the same session. A draft now names the composer it is for,
  which is what stopped the Deck's composer claiming the page attachment and
  then unmounting with it.

### Added (Chrome settings parity)

- **The Browser tab is chrome://settings, in WebDeck's window.** The sections,
  their order and their wording are Chrome's — You and Google, Autofill and
  passwords, Privacy and security, Performance, Appearance, Search engine, On
  startup, Downloads, Languages, Accessibility, System, Reset — and each row is
  provided the way Chrome provides it. A preference Chrome shows as a switch or
  a dropdown is a switch or a dropdown here, writing the same pref
  chrome://settings writes; a setting Chrome hands to a subpage (passwords,
  payment methods, addresses, site permissions, search engines, languages,
  reset) is a row that opens Chromium's real page. There is a search box over
  the whole surface, as Chrome has. Safe Browsing is its three-way choice over
  the two booleans behind it.
- **An allowlisted preference bridge.** chrome://settings is a page of controls
  over the profile's PrefService, so the shell needed the same values — but a
  renderer that could name any pref would be a hole the size of the browser.
  The browser keeps a list: 27 preferences, each with its type, whether it
  lives in the profile or in Local State, and whether it may be written at all.
  A name that is not on it reads back exactly like one this build does not
  register, so refusing leaks nothing. Wrong types are refused, policy-managed
  prefs are refused and drawn disabled, and two prefs that the surface only
  displays (the download folder, the language list) are read-only here and
  changed on Chromium's own page — otherwise an arbitrary download directory
  plus "don't ask where to save" would be a writable-path primitive.
- A row whose pref this build does not register is hidden rather than drawn
  dead, which is how the wrong caret-browsing pref name was caught.

### Added (settings QA round)

- **Ask.** A button at the end of the tab strip, where Chrome keeps "Ask
  Gemini", that points the agent at the page you are looking at. Chrome's
  version is its Gemini side panel, which is compiled out of an unbranded
  Chromium and loads a Google-hosted client, so this browser cannot carry it.
  Ours takes a snapshot of the active tab's visible text, brings the Agents
  block forward with the page attached ("Sharing …"), and offers starters —
  summarise, what can I do here, explain the terms, fill in the form. The agent
  reads the page first and then is the ordinary agent: every tool, the same
  permissions and guards, the same transcript. The page text is handed to the
  model as data to answer from, with the same injection framing as chat-with-
  page, and capped in the core.

- **Ask Gemini.** The omnibox answer panel can hand the same question to
  Gemini and back, streaming from Google's API in the core. The button appears
  only when a Gemini key is configured, so it can never be a button that only
  says "no key"; the panel names which model answered. The key never leaves the
  core — the page sees tokens.

### Fixed (feedback round)

- **Pinned extensions now appear in the toolbar.** Chromium draws extension
  buttons in its own toolbar, which this build does not have — the toolbar is
  the shell's page — so "Pin to toolbar" in chrome://extensions was a switch
  with nowhere to show its result. The shell reads the same pinned list
  Chromium's toolbar reads, with each action's per-page title, badge and
  enabled state, and draws them; the icon comes from Chromium's own
  chrome://extension-icon. Clicking one runs the action exactly as the native
  button would, and the browser opens the extension's popup in its own window.
- **The profile button shows the signed-in Google account**, picture and all,
  and updates on its own. It read the profile only while its menu was open, so
  the icon never changed; the account now comes from the browser (its identity
  manager) on load and after each navigation, which is also when a freshly
  downloaded avatar first exists.
- **The profile menu names the account** instead of opening with four links to
  nowhere in particular, and links straight at Chromium's own passwords,
  autofill and addresses, payment methods and sync pages. Those read the
  profile's encrypted store and cannot be rebuilt outside Chromium's settings,
  so pointing at them is the whole job.
- **The address bar can reach the browser's own pages.** Typing any
  `chrome://…` URL was handed to the search engine as a query, because the
  URL-or-search test did not know the scheme. chrome://password-manager, where
  chrome://settings/passwords redirects, was also missing from the shell's
  navigation allowlist, so saved passwords were doubly unreachable.
- **Markdown, JSON, CSV and friends open in Document Studio again** when
  navigated to, with its styled/source toggle, instead of rendering as raw
  text. The interception lived in the Electron main process and was deleted
  with it; the decision now lives in shared code and runs before a native view
  is created, so a workspace document never flashes as plain text. It is still
  limited to documents inside the open workspace.

### Changed

- **Apple Silicon only, deliberately.** Intel Macs are out of scope; Windows
  and Linux come first when the platform list grows. Packaging no longer warns
  about the missing universal build.

### Added

- **A normal Mac install.** `package-fork` gained `--identity` and
  `--notary-profile`: it signs every Mach-O in the bundle inside-out with the
  hardened runtime and a secure timestamp, notarizes and staples the app,
  builds the disk image around the stapled app, then signs, notarizes and
  staples the image, and finally asserts that Gatekeeper says _accepted,
  source=Notarized Developer ID_ and that the ticket survives on the app inside
  the volume. `npm run release:dmg` is the whole release; `npm run
release:preflight` reports which of the three Apple credentials is missing
  and the exact command that obtains it. The credential itself is never read by
  anything here — `notarytool` gets a keychain profile name.
- **The development keychain can no longer ship.** Packaging a build with
  `webdeck_dev_keychain = true` is a blocker unless `--allow-dev-keychain` is
  passed, because that build keeps the cookie and password key in a plaintext
  file. Release builds set it to `false`, and the flag's helpers now compile
  out cleanly when it is off (they tripped `-Wunused-function` under `-Werror`).
- **Permissions live in the composer.** The permission mode is a pill beside
  the model pill ("Full autonomy · 2 guards") opening one popover with the
  modes, the guards, custom rules and the per-site decisions; the Agents
  header keeps a shield that opens the same popover. The two settings strips
  above the transcript are gone.
- **Guards are separate choices.** The single "banking, payment and password
  sites" switch is now five: payments & checkout, banking & brokerage,
  passwords & identity, email & messaging, posting publicly. Payments and
  posting also match by path (a checkout-looking page; a new issue, pull
  request or release on a code host). Prompts name the guard that asked. An
  older policy file's single switch carries over to the first three guards.
- **Guards reach injected script.** `browser_eval` was gated only as a
  command, which full autonomy allows, so script could act on a guarded
  checkout or banking page that a click would have asked about. It is now
  checked against the page it runs on first, like a click or a keystroke; an
  end-to-end test drives click, type and eval on a guarded page under full
  autonomy and expects a prompt for each.
- **Popovers are never clipped by their block.** Menus opened inside a Deck
  block (the permission panel, conversation history) render through a portal
  with fixed positioning: clamped to the window, flipped to the side with
  room, and capped to the space available so they scroll instead of running
  off the edge. The composer's bottom row stays on one line at any block
  width (the permission pill truncates; nothing wraps).
- **Responsiveness pass across the shell** (audit at the Deck's 330×260
  minimum and in narrow windows): the tab context menu and the editor's
  outline menu were rendered inside `overflow-hidden` parents and clipped
  (the outline menu never showed at all; the rail's tab menu was invisible) —
  both are portalled now; the Files block's recents no longer squash into
  half-height rows; the branch, downloads, bookmarks, omnibox and profile
  menus cap their height to the window and scroll; the REST history and DB
  schema sidebars give way below 45% of the block; the CSV filter and the
  start page's brand lockup shrink with their container.
- The new-tab page's WebDeck mark is 60px (was 40px).

- **A browsing-first new-tab page**: the address field is focused, top sites
  and bookmarks are one click away, and projects are one quiet row (recents
  plus "Open a project…"). The brand lockup and opener show only while the
  profile is fresh.
- **Shell-owned browser commands**: in a WebDeck window the native menu and
  key equivalents that fire while the page has focus (⌘T, ⌘W, ⌘L, ⌘F, ⌘⇧T,
  ⌘1–9, ⌘⇧[ ], DevTools, Bookmark This Tab) are forwarded to the shell
  (`ShellClient.OnCommand`) instead of running Chromium's handlers — so ⌘T
  opens WebDeck's new tab, never chrome://newtab.
- **⌘D reveals the Dev Deck** from anywhere, page focused or not
  (`IDC_WEBDECK_TOGGLE_DECK`); Bookmark This Tab moves to ⌘⌥D.
- **Vertical tabs as a rail block** docked beside the page, with tab groups as
  sections; the toolbar moves up into the title bar in that mode.
- **Native path picker** (`Shell.PickPaths`): "Open…" on the start page and in
  the Files block opens the folder panel; agent attachments pick real files.
- **Development keychain** (gn arg `webdeck_dev_keychain`, off by default): on an
  ad-hoc or unsigned bundle the cookie encryption key is a stable 0600 file in
  the profile instead of a login-Keychain item, so dev builds never raise the
  "Chromium Safe Storage" prompt. `WEBDECK_REAL_KEYCHAIN=1` forces the real
  Keychain; `verify:hardening --release` warns when the flag is on.
- `verify:hardening --release` reports whether the bundle carries a Team
  Identifier.
- Electron removed: WebDeck is the Chromium fork only.
- VS Code extensions from Open VSX; each contributed view is its own block.

## v0.1.0 — 2026-09-01

First tagged release. Arcwel WebDeck is an agent-first universal IDE and browser
built as a **forked Chromium (M153)**: the browser _is_ WebDeck — a React shell
at `chrome://webdeck` draws the browser chrome while real pages render in a
positioned stage, and an IDE + agent runtime (`webdeck-core`) runs alongside.

### Browser

- Integrated Chromium browsing driven by the WebDeck shell (glass tab strip,
  toolbar, omnibox), with the shell owning window chrome and a draggable title bar.
- Ad & tracker blocking (app-side settings + a Chromium URL-loader throttle).
- Unpacked MV3 browser extensions load into the browsing session.
- Reader Mode, find-in-page, zoom, per-tab devtools, PiP, split view.

### IDE

- Monaco-based editor, file tree, and a real terminal (node-pty), plus LSP/DAP
  language support with vendored servers.
- Live Preview and a slide runtime; Document Studio (stylized JSON/Markdown viewer).
- Jupyter notebook block; REST/DB blocks in the Dev Deck.
- VS Code parity pass for the core editing surface (editor extensions from
  Open VSX are deferred — see SECURITY.md).

### Agent

- Mission Control agent orchestration with an Agent Composer input surface.
- Autonomous browser control and verification (the agent drives real tabs via a
  scoped `chrome://webdeck` ↔ core interface), with artifacts & execution reports.
- Permission modes with a fail-closed policy gate (`checkAction`).

### Security & hardening

- `chrome://webdeck` ↔ core boundary carries a per-boot token and an
  `Origin`-header allowlist; the WebUI CSP pins `connect-src` to loopback only.
- Agent browser navigation is restricted to `http`/`https` — `file://` is
  rejected on both the client allowlist and the C++ `Page.navigate` gate, closing
  an arbitrary local-file disclosure path.
- `verify:hardening` proves the process sandbox and full site isolation are on at
  runtime (Site-Per-Process + a cross-site OOPIF test) and, with `--release`,
  hard-fails a build whose gn config drifted off the shippable settings.

### Release engineering

- Reproducible fork: pinned base in `chromium/fork.json`, tracked patches, and
  `verify:patches` / `verify:fork` / `verify:hardening` gates.
- `upstream:check` reports when the pinned base falls behind and whether the
  patch set still applies.
- `update:check` — a signed-manifest auto-update **channel**: a pinned Ed25519
  key verifies each appcast (fail-closed), so an unsigned update can never be
  offered. Binary download/apply and the in-product prompt are tracked for a
  later release.

### Known limitations

- Signed distribution (DMG notarization) needs an Apple Developer ID and is
  documented, not automated (`chromium/RELEASING.md`).
- Headless/CI launches of a build without the development keychain must pass
  `--use-mock-keychain`: without an interactive login keychain, the cookie
  store's OSCrypt key fetch blocks and the shell cannot boot. (Superseded for
  dev builds by `webdeck_dev_keychain`; see Unreleased.)
- Auto-update is check-only; upstream tracking automation and update delivery
  (13.7) are in progress.
