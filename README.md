<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/webdeck-lockup-dark.svg" />
    <img src="assets/webdeck-lockup-light.svg" alt="Arcwel WebDeck" width="320" />
  </picture>
</p>

<h1 align="center">Arcwel WebDeck</h1>

<p align="center"><strong>A browser that builds.</strong><br />
A real Chromium browser. Press <kbd>⌘D</kbd> and a full IDE and an agent slide in around the page you're already looking at.</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-you-get">Features</a> ·
  <a href="docs/getting-started.md">Getting started</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img src="assets/readme/deck.png" alt="WebDeck with the Dev Deck revealed around a page: the agent, editor, terminal and file tree as blocks docked around the spotlit stage" width="960" />
</p>

---

## Why WebDeck

Every IDE eventually grows a browser, and it is always the worst browser you own: a preview pane with no tabs, no extensions, no devtools worth the name. Every browser eventually grows developer tools, and they stop at inspecting someone else's code.

WebDeck starts from the other end. It **is** Chromium, a fork of the real thing, with tabs, extensions, profiles, downloads, permissions and devtools. When you need to build, the **Dev Deck** slides in around the page: editor, terminal, files, source control, debugger, tasks, notebooks, and an agent that can drive the tabs you are looking at. Press <kbd>⌘D</kbd> again and it is a browser again.

Three things follow from that ordering:

- **The page is never second-class.** Read the docs, try the thing, check the result, all in one window. The agent verifies its work in the same browser you use, logged in as you.
- **The agent shows its work.** It plans first, you approve, and then every command runs in a live terminal inside the conversation, every edit ships a diff, and every browser action happens in a tab you can see. A policy engine gates anything irreversible.
- **The IDE is real.** The editor runs on VS Code's own service layer: your settings, keybindings, themes and extensions from Open VSX, with language intelligence over LSP and debugging over DAP.

## What you get

### A real browser

- Chromium M153, branded and built as Arcwel WebDeck. Tabs sit in the title bar, inline with the traffic lights; the toolbar carries the address bar, bookmarks, extensions and profile.
- **Tab groups, drag-to-reorder, tab search, split view, Picture-in-Picture, Reader Mode, find in page, zoom, print, per-tab DevTools.**
- **Vertical tabs** as a rail block docked beside the page, with groups as sections.
- A **new-tab page that is a start page**: address field focused, top sites, bookmarks, and one quiet row of projects. Every shortcut works whether the page or the shell has focus; <kbd>⌘D</kbd> always means the Deck.
- Chromium **profiles** and the real `chrome://settings`, `chrome://extensions` and `chrome://history`. Browser sign-in to Google is not possible in a fork — see [Sync and your data](#sync-and-your-data).
- **Extensions** from the Chrome Web Store, per profile.
- **Ad and tracker blocking** with a live blocked count, third-party cookie controls, Do Not Track, HTTPS-Only mode.
- A summonable **favourites bar** that floats above the page and can be pinned.
- **Menus never blank the page.** A menu that stays inside its block or the dock leaves the page live. One that opens over the page — the toolbar menus, the address dropdown, the palette, Settings — sits on a still of the page taken the instant it opens, so what you were reading stays in view.

### The Dev Deck

- <kbd>⌘D</kbd> retreats the page into a spotlit stage and docks your blocks around it: a right column, a bottom dock, a left column and a collapsed rail.
- Every block is a peer: drag into stacks, split out, **float into its own window**, or **detach the whole Deck into a second window**. Blocks fit their zone or become a tab in a stack; they never overlap.
- Every zone is yours to size: drag the edge of the left column, the right column or the bottom dock. Each bottom corner has a toggle at its junction, so the dock can run the full width under a column, or the column can stand full height beside the dock, set per side.
- Layouts persist per project, with **Browsing**, **Building** and **Debugging** presets.
- Blocks: **Agent · Editor · Files · Terminal · Source Control · Git Graph · Debug · Tasks · Search · Preview · Notebook · REST client · Database · Page Assistant · Extensions · Settings**, plus any **extension view** as its own block.

### An agent that acts as you

- Plan → approve → execute → verify. The plan is editable before anything runs.
- Commands run in **live terminals inside the transcript**; file edits come with before/after diffs; browser actions drive real tabs in your session over an in-process DevTools channel, never a debugging port.
- **Agent Vision**: the agent reads the page, the console and the network of the tabs it opened.
- **Ask**, at the end of the tab strip: the agent, pointed at the page you are on. It reads the page first, offers starters (summarise, what can I do here, fill in the form), and then behaves as the ordinary agent — every tool, the same permissions.
- Composer with **attachments** from the native file panel, `@mention` for workspace files, `/` commands, voice input, and a model picker (Anthropic, OpenAI, Gemini).
- **Permissions where the run starts.** A pill beside the model picker in the composer sets the mode, from Secure (ask about everything) to Full autonomy (never asks), with custom rules and the standing per-site decisions in the same popover.
- **Five guards, each its own switch**: payments & checkout, banking & brokerage, passwords & identity, email & messaging, posting publicly. A guard makes the agent ask before it navigates to, clicks, types in or runs script on that kind of page, even under full autonomy. Inline prompts name the guard that asked; an audit log records every decision. The policy gate fails closed.
- Conversations rename, branch from any turn, export, and hand back to the composer.

- **Or on a model on this Mac.** Settings → AI → On this Mac lists what Ollama holds, with the capabilities the runtime reports, and either the agent or Ask can run there. Nothing leaves the machine, no key is needed, and the choice stays on this machine. When the runtime is not answering, or a model garbles a tool call or stops mid-answer, the agent says so in a sentence and stops, rather than guessing.

### A genuine IDE

- Editor on **VS Code's service layer**: real `settings.json` and `keybindings.json`, themes, TextMate grammars, quick-access, breadcrumbs, outline, minimap.
- **Extensions from Open VSX** run in the web extension host; each contributed view becomes a Deck block.
- **Language intelligence** over LSP: completion, go-to-definition, references, rename, hover, diagnostics, code actions. Servers ship inside the core for TypeScript and JavaScript (typescript-language-server), Python (pyright) and Rust (rust-analyzer); Go uses your `gopls`. Adding one is documented in [`app/docs/LANGUAGE_SUPPORT.md`](app/docs/LANGUAGE_SUPPORT.md).
- **Debugging** with Microsoft's js-debug: breakpoints, stepping, call stack, variables, watch, source maps.
- **Source control**: status, staged and unstaged diffs, stage, commit, branches.
- **Tasks** with problem matchers, so a build error lands as a squiggle on the line that caused it.
- **Terminal** on node-pty, **multi-root workspaces**, workspace search, dev-server preview.

### Document Studio

Markdown, JSON, YAML, CSV, TSV, XML, SVG and TOML render as styled documents with Mermaid diagrams and math, a one-click toggle to source, and export to HTML or PDF. `.slides.md` files become Reveal.js decks.

**Files open where they live.** Drop one on the window, pick one with **Open file…**, or click it in the Files block: a document opens in Document Studio at its own path, editable and saveable in place. Source and plain text — Python, JavaScript, Go, Rust, shell, SQL, CSS, `.txt` and some forty more — open the same way, in the source view, with **Open in Editor** for when you want it in the Deck. Nothing is copied and nothing is posted through the socket, so a large file costs what reading a file costs. A PDF goes the other way, to Chromium's own viewer with its annotation tools; images and HTML render there too.

The view follows the file: it reloads on a change inside the open project, right after each save from the editor, and every 30 seconds for a file outside any project. Files you opened this way come back after a relaunch like any other tab, as long as they still exist.

The page carries the path but is not trusted with it. The browser signs a path only when you actually picked or dropped that file, with a key the page never holds, and the core refuses anything unsigned.

### Settings

Settings open as their own surface: Application, AI keys (held in the OS keychain, or read from your password manager so WebDeck stores nothing), Colours (every colour the app paints), Browser privacy, and the VS Code Editor and Keybindings documents. **WebDeck Sync** keeps settings, policy, model and theme identical across machines through a local-first file, with no account and no server.

### Bring your history and bookmarks with you

Settings → WebDeck → Application lists every browser profile on the machine with a page count and an Import button: Chrome, Edge, Brave, Vivaldi, Opera, Arc, Chromium, Firefox and Safari. Importing the same browser twice adds nothing rather than doubling what is there. Bookmarks import from an exported HTML or JSON file.

### Sync and your data

**WebDeck cannot sync with a Google account, and that is Google's decision rather than a gap here.** Signing in to a Chromium build needs an OAuth token that grants access to Chrome Sync, and Google issues it only to Google Chrome. Chromium's own documentation says so. Supplying your own API keys does not change it: the keys are not the barrier, the token is.

A Google account still works normally in a tab. Gmail, Drive and Docs are unaffected. What cannot happen is the browser itself signing in to sync your bookmarks to Google.

So both halves are ours. [`sync/`](sync/README.md) is a service that speaks Chromium's own sync protocol, built against the browser's own `.proto` files rather than a transcription of them, plus the identity endpoints the sign-in layer talks to. `--sync-url` redirects one and `--gaia-config` redirects the other, and both switches are already in the browser we ship.

```bash
cd sync && npm install
./src/cli.mjs account --add you@example.com     # prints a refresh token
./src/cli.mjs serve                             # then --sync-url=http://127.0.0.1:8384
```

It carries commits and updates for all 75 datatypes, with per-account storage, progress markers, tombstones and store birthdays. What is not finished: the interactive sign-in pages, the encryption node, and a completed round trip with a real browser. Until then, **import** is the way to bring existing data in.

### Built to be trusted

- `chrome://webdeck` is a privileged WebUI page under Chromium's process sandbox and full site isolation; `verify:hardening` measures both on the running binary.
- The page reaches the core only over a loopback WebSocket with a per-boot token; its CSP allows no remote origin, no eval, no inline script.
- The agent's file tools are pinned to the folders you opened, and its browsing is limited to `http` and `https`.
- Every trust boundary and residual risk is written down in [`SECURITY.md`](SECURITY.md).

## Screenshots

|                                                                                                                                              |                                                                                                                                            |
| :------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="assets/readme/browser.png" alt="Browsing: tabs in the title bar, the toolbar, and a page" />                                       | <img src="assets/readme/tab-rail.png" alt="Vertical tabs as a rail block docked to the page" />                                            |
| Browsing full-screen                                                                                                                         | Vertical tabs as a rail block                                                                                                              |
| <img src="assets/readme/deck-window.png" alt="The Dev Deck detached into its own window" />                                                  | <img src="assets/readme/agent-attach.png" alt="The agent composer with an attached file" />                                                |
| The Deck in its own window                                                                                                                   | Attaching files to the agent                                                                                                               |
| <img src="assets/readme/permissions.png" alt="The permission popover open above the composer: the five modes and the five guards" />         | <img src="assets/readme/deck-small.png" alt="The Deck in a 760 by 640 window: every block and popover fits" />                             |
| Permission modes and guards, from the composer                                                                                               | The Deck in a small window                                                                                                                 |
| <img src="assets/readme/document-studio.png" alt="A markdown file rendered in Document Studio, with a table, a list and highlighted code" /> | <img src="assets/readme/history-import.png" alt="Import browsing history: every browser profile found on the machine, with page counts" /> |
| A document in Document Studio                                                                                                                | Importing history from another browser                                                                                                     |

## Install

**Requirements:** macOS 13 or later on Apple Silicon.

1. Download `Arcwel-WebDeck-<version>-arm64.dmg` from the [releases](https://github.com/arcwel/WebDeck/releases).
2. Open it and drag **Arcwel WebDeck** to Applications.
3. Open it from Applications or Launchpad.

That is the whole install for a signed release. The build is notarized by Apple
and the ticket is stapled to both the app and the disk image, so it opens the
first time, with no warning and with no network.

The agent needs a provider key. **Settings → AI** stores it in the macOS Keychain, or points WebDeck at your password manager (`op read`, `pass show`, `security find-generic-password`, `vault read`). `ANTHROPIC_API_KEY` in the environment also works.

Then read [Getting Started](docs/getting-started.md): the first five minutes, the blocks, and the shortcuts.

### Opening a pre-release build

A build that has not been through Apple's notary service — anything from
`npm run package:dmg`, and every release candidate before the first signed one
— is refused on first launch. **On macOS 15 and later, Control-clicking the app
no longer offers a way past this.** The one supported route:

1. Double-click the app once. macOS refuses it; dismiss the dialog.
2. Open **System Settings → Privacy & Security**, scroll to Security, and click
   **Open Anyway** beside the message naming Arcwel WebDeck.
3. Confirm. It opens normally from then on.

Or install it from the mounted disk image in one command, which copies the app
and clears the quarantine flag the download added:

```bash
cp -R "/Volumes/Arcwel WebDeck/Arcwel WebDeck.app" /Applications/ && xattr -dr com.apple.quarantine "/Applications/Arcwel WebDeck.app"
```

If Finder shows a crossed-out icon on the app, that is a stale Launch Services
record rather than a broken build:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Arcwel WebDeck.app" && killall Finder
```

### Testing a pre-release build

What to know before you start:

- **The profile lives in `~/Library/Application Support/Chromium`** and is separate from Chrome's. Nothing in your Chrome profile is read or changed.
- **Start the agent in Review-driven or Agent-driven mode.** Leave the three money and identity guards on, and turn on **Email & messaging** and **Posting publicly** if the agent will be anywhere near your mail or social accounts.
- **Cast is off** by default, so no "find devices on the local network" prompt.
- **macOS asks once for Keychain access** ("Arcwel WebDeck Safe Storage"), the same prompt Chrome raises. Click **Always Allow** and it does not come back for that build. It asks because the build is not yet notarized; dragging the app to Applications, rather than running it from the disk image, is what keeps the answer sticking. A newer build asks again, because an unsigned build has a new identity every time — see [The development loop](#the-development-loop) for how a developer avoids that.

Things worth trying: browse for a while and see whether anything feels less than Chrome; press <kbd>⌘D</kbd> over a page and give the agent a task that touches the page you are looking at; resize the window down to about 760 × 640 and open every menu; open a project and use the editor, terminal and source control together; detach the Deck into its own window.

**Feedback:** open an issue at [github.com/arcwel/WebDeck/issues](https://github.com/arcwel/WebDeck/issues) with what you did, what you expected, what happened, and a screenshot. For a crash, attach the newest report from `~/Library/Logs/DiagnosticReports`. For anything security-related, see [SECURITY.md](SECURITY.md) rather than a public issue.

## Build from source

WebDeck is two builds: the **core** (a Node service compiled to a single executable) and the **browser** (a Chromium checkout with this repository's patches applied). Full detail, including signing and notarization, is in [`chromium/RELEASING.md`](chromium/RELEASING.md).

**Prerequisites:** Xcode with command-line tools, depot_tools, a Chromium checkout at the base pinned in [`chromium/fork.json`](chromium/fork.json) (about 100 GB and a few hours the first time), Node 20+.

```bash
# 1. The core
cd app && npm ci && npm run build:core

# 2. The browser: apply the patch set to the checkout, then configure and build
node scripts/verify-patches.mjs                     # the repo describes the fork
autoninja -C out/webdeck-release chrome/browser/ui/webui/webdeck:mojo_bindings
npm run pack:webui:release                          # WebUI + Mojo bindings for THIS out dir
autoninja -C out/webdeck-release chrome -j 6

# 3. Put the core in the bundle, prove it, package
node scripts/install-core.mjs --app "out/webdeck-release/Arcwel WebDeck.app"
node scripts/verify-deliverable.mjs --app "out/webdeck-release/Arcwel WebDeck.app"
node scripts/package-fork.mjs --build-dir out/webdeck-release --out ../dist
```

### The development loop

| Change                                             | Rebuild                                                                                                                                                                                                                          |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebUI (React, `app/src/renderer`, `app/src/webui`) | `npm run pack:webui` (component build) or `pack:webui:release`, then `autoninja … chrome` relinks in about three minutes                                                                                                         |
| Core (`app/src/core`)                              | `npm run build:core && node scripts/install-core.mjs --app <.app>`; no browser rebuild                                                                                                                                           |
| Chromium patches (`chromium/patches`)              | Edit the checkout, `git diff --binary > chromium/patches/upstream-edits.diff`, `npm run verify:patches`                                                                                                                          |
| A `.mojom` change                                  | `autoninja -C <out> chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator` first (the page's bindings; `chrome` does not depend on them), then pack, then `chrome`. Packing refuses bindings that do not match the out dir |

A build you rebuild every hour should not ask for your login password every hour. Two things stop it, and both are for builds that stay on your machine:

```bash
npm run dev:signing-identity      # once: a self-signed identity in its own keychain, so every build carries the same signature
# in out/<dir>/args.gn:  webdeck_dev_keychain = true   — the cookie key lives in the profile, not the login keychain
node scripts/package-fork.mjs --build-dir out/webdeck-release --out ../dist --identity "Arcwel WebDeck Dev" --allow-dev-keychain
```

Every file drop leaves a line in `~/.webdeck/drops.log` saying whether the shell was listening and what it took, because a drop only happens under a real hand and nothing automated reaches that path.

Verification gates, in the order CI runs them:

```bash
npm run lint && npm run typecheck && npm test        # the app
npm run verify:patches                               # the repo reproduces the fork
npm run verify:fork -- --browser <binary>            # the shell boots, opens a project, exports
npm run verify:hardening -- --browser <binary> --release   # sandbox, site isolation, CSP, gn config, signature
node scripts/verify-deliverable.mjs --app <.app>     # runs on a machine that never saw the build tree
```

### Settings

The **Browser** tab in Settings mirrors chrome://settings: the same sections in the same order, with each setting provided the way Chrome provides it. Simple preferences are switches and dropdowns that write the pref Chromium itself writes; the ones Chromium must own — passwords, payment methods, addresses, site permissions, search engines, languages, reset — are rows that open Chromium's own page. The browser answers only for an allowlist of preferences, so the shell can never name an arbitrary one.

### Making the installer

```bash
cd app
npm run release:preflight          # which Apple credentials are missing, and how to get each
npm run release:dmg -- --build-dir <out dir> --out <dir>
```

`release:dmg` signs the bundle inside-out with the hardened runtime, notarizes and staples the app, wraps it in a disk image, signs and notarizes that too, then proves the result with `spctl` and `stapler validate`. It needs a Developer ID Application certificate and a `notarytool` keychain profile; the preflight prints the exact command for whichever is missing, and the password never passes through this repository.

Without those credentials, `npm run package:dmg` produces the same disk image ad-hoc signed. It installs and runs, but testers meet Gatekeeper once — see [Opening a pre-release build](#opening-a-pre-release-build).

Developer builds may set the `webdeck_dev_keychain` gn arg, which keeps the cookie encryption key in the profile rather than raising the macOS Keychain prompt on every rebuild, and sign with the identity `npm run dev:signing-identity` creates so the signature is the same across rebuilds. Packaging treats such a build as not distributable. See [`chromium/RELEASING.md`](chromium/RELEASING.md).

## How it fits together

```
┌──────────────────────────── Arcwel WebDeck.app ────────────────────────────┐
│  Chromium (M153 + chromium/patches)                                        │
│   ├─ chrome://webdeck  ── the WebUI shell: tabs, toolbar, Deck, blocks     │
│   │      │  Mojo (Shell, AgentTabs): stage bounds, tabs, windows, pickers  │
│   ├─ the staged tab ── the real page, positioned into the shell's stage    │
│   └─ webdeck-core  ── Node single-executable, spawned by the browser       │
│           loopback WebSocket + per-boot token                              │
│           files · terminals · LSP · DAP · git · tasks · agent · policy     │
└────────────────────────────────────────────────────────────────────────────┘
```

The shell page owns the window and streams the stage rectangle to the browser; Chromium positions the active tab into it. Deck and float windows are ordinary browser windows whose shell page carries a role. The core is the same on every host, so the UI never knows which process answered.

## Repository map

| Path               | What it holds                                                                                                  |
| :----------------- | :------------------------------------------------------------------------------------------------------------- |
| `app/src/renderer` | The shell UI: React, TypeScript, Tailwind. Blocks, Deck, tab strip, composer                                   |
| `app/src/webui`    | The `chrome://webdeck` entry: Mojo bridge, pickers, exports, window sync                                       |
| `app/src/core`     | `webdeck-core`: the domains (fs, terminal, lsp, debug, git, tasks, agent, policy, workspace) and the transport |
| `app/scripts`      | Build, pack, verify and package scripts                                                                        |
| `chromium/`        | The fork: `fork.json` pin, `patches/` (new file trees plus `upstream-edits.diff`), build and release docs      |
| `sync/`            | The sync and identity service, and Chromium's sync `.proto` files vendored from the checkout                   |
| `docs/`            | User guides                                                                                                    |
| `design/`          | Design canvases and review pages                                                                               |

## Documentation

| Document                                                                                                        | Read it when                                                                              |
| :-------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| [Getting Started](docs/getting-started.md)                                                                      | You have just installed it                                                                |
| [Agent Workflows](docs/agent-workflows.md) · [Permission Modes](docs/permission-modes.md)                       | You are giving the agent work                                                             |
| [Document Studio](docs/document-studio.md) · [Settings Sync](docs/settings-sync.md)                             | You want the rendered docs or the same setup on two machines                              |
| [Local models](docs/local-llm-plan.md)                                                                          | Running the agent and Ask on a model on this Mac: what is built (Ollama), what is planned |
| [Devices plan](docs/device-sync-plan.md)                                                                        | Tabs from your other devices, and sending things between them (a plan)                    |
| [`PRD.md`](PRD.md) · [`ROADMAP.md`](ROADMAP.md)                                                                 | You want to know what it is for and where it is going                                     |
| [`DESIGN.md`](DESIGN.md)                                                                                        | You are changing how the Deck looks or moves                                              |
| [`IDE_FOUNDATION.md`](IDE_FOUNDATION.md)                                                                        | You are touching the editor, LSP or DAP                                                   |
| [`SECURITY.md`](SECURITY.md)                                                                                    | You are touching the agent, the policy gate or a process boundary                         |
| [`chromium/README.md`](chromium/README.md) · [`chromium/SHELL_ARCHITECTURE.md`](chromium/SHELL_ARCHITECTURE.md) | You are working on the fork or the Shell interface                                        |
| [`chromium/RELEASING.md`](chromium/RELEASING.md) · [`chromium/SHIPPABLE.md`](chromium/SHIPPABLE.md)             | You are cutting a release                                                                 |
| [`CHANGELOG.md`](CHANGELOG.md)                                                                                  | You want to know what changed                                                             |
| [`sync/README.md`](sync/README.md)                                                                              | You want to run the sync or identity service, or change the protocol                      |

## Contributing

- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `security:`). Commit from the repository root.
- Before a commit: `npm run lint && npm run typecheck && npm test` in `app/`, and `npm run verify:patches` when the fork changed.
- UI work is reviewed on the real window, with screenshots, before it is called done.
- Design changes go through a review page first (see `design/`).

## Status

Pre-release, in user testing. The browser, the Dev Deck, the agent with its permission engine and guards, the IDE layer and Document Studio are built, verified on the real window at normal and small window sizes, and shipped as a release candidate DMG. Signed distribution needs an Apple Developer ID and is documented, not yet automated. The [changelog](CHANGELOG.md) lists what changed in each round.

## License

Arcwel WebDeck is [MIT licensed](LICENSE). It is a derivative of Chromium (BSD-3-Clause) and embeds the Node.js runtime (MIT); the inventory of bundled components and their licences is in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) and under **Settings → About**. The browser's own components are credited at `chrome://credits`.

---

<p align="center"><sub>An <strong>Arcwel</strong> project · MIT licensed</sub></p>
