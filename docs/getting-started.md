# Getting Started

Arcwel WebDeck is a browser first. You browse the web full-screen, and when you
need to build something you press **⌘D** and a full IDE — editor, terminal, files,
source control, debugger, and an agent — slides in around the page you're already
looking at. Press ⌘D again and it's a browser again.

This guide gets you from the download to giving the agent its first task.

## Prerequisites

- **macOS 13 or later** on Apple Silicon.
- An **Anthropic API key** if you want to use the agent (optional for browsing and
  the IDE). OpenAI and Gemini keys work too. Or no key at all: with
  [Ollama](https://ollama.com) installed, the agent and Ask can run on a model on
  this Mac (see step 4).

## Install it

1. Download `Arcwel-WebDeck-<version>-arm64.dmg` from the
   [releases page](https://github.com/arcwel/WebDeck/releases), or build it from
   source (see the [README](../README.md#build-from-source)).
2. Open the DMG and drag **Arcwel WebDeck** into Applications.
3. On the first launch of a build that is not notarized, right-click the app and
   choose **Open**, then confirm. It opens normally after that.

The window opens as a browser. That's the point — WebDeck _is_ a real Chromium
browser (tabs, extensions, profiles, downloads, permissions, devtools), not a
preview pane.

## Your first five minutes

1. **Browse somewhere.** Use the address bar like any browser. Tabs sit inline with
   the window's traffic lights and show real favicons.
2. **Open a project folder.** On a new tab, press **Open…** to choose a folder
   (or type a path), or use the Files block once the deck is open. Everything the
   agent and IDE can touch is scoped to the folders you open — see
   [Permission Modes](permission-modes.md).
3. **Press ⌘D.** The page retreats into a spotlit frame and the **Dev Deck** slides
   in around it. Every panel is a _block_ you can drag, stack, split, float into its
   own window, or collapse to the rail. Layouts persist per project.
4. **Add your API key.** Open **Settings → AI** and paste an Anthropic key. It's
   encrypted into the OS keychain (Keychain / libsecret / DPAPI) via `safeStorage`,
   never written as plaintext and never exposed to the page. Or set the
   `ANTHROPIC_API_KEY` environment variable before launching.

   **Or use a model on this Mac.** Under **Settings → AI → On this Mac**, WebDeck
   shows whether Ollama is installed and answering (with a Start button if it is
   not), lists the models it holds with what each can do — tools, thinking,
   vision, context size — and lets you choose one for the agent, for Ask, or
   both. A model that cannot call tools can answer Ask but is refused for the
   agent, with the reason. The composer's model picker groups **Cloud** and
   **On this Mac**, with a blue dot for a model that runs here. The choice stays
   on this machine and never syncs; "back to Claude" clears it. If Ollama stops
   answering, the Agents block says so and names how to start it again.

5. **Give the agent a task.** In the **Agent** block, describe what you want. The
   agent plans first, shows you the plan, and waits for your approval before doing
   anything. See [Agent Workflows](agent-workflows.md).

## The Dev Deck blocks

| Block                          | What it does                                                                                                      |
| :----------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **Editor**                     | Code editor on VS Code's own service layer — real config, keybindings, themes, and language intelligence over LSP |
| **Files**                      | The workspace file tree; open a doc here to see it as a styled [Document Studio](document-studio.md) view         |
| **Terminal**                   | Full terminals, including the live ones the agent runs inside its conversation                                    |
| **Agent**                      | Mission Control: give tasks, review plans, watch execution                                                        |
| **Source Control**             | Git status, staged/unstaged diffs, stage/unstage, commit, branch switching                                        |
| **Debug**                      | Breakpoints, stepping, call stack, variables, watch — via Microsoft's js-debug                                    |
| **Tasks**                      | Run `package.json` / `tasks.json` scripts; output becomes editor diagnostics                                      |
| **Git Graph**                  | The commit graph, branches and tags                                                                               |
| **Search**                     | Workspace-wide search                                                                                             |
| **Preview**                    | Live dev-server preview                                                                                           |
| **Notebook**                   | Jupyter notebooks, run in place                                                                                   |
| **REST client** / **Database** | Send requests and query databases from the Deck                                                                   |
| **Page Assistant**             | Ask about the page you are looking at                                                                             |
| **Extensions**                 | Install VS Code extensions from Open VSX; each view becomes its own block                                         |
| **Settings**                   | Application, AI, Colours, Browser privacy, and the VS Code Editor / Keybindings docs                              |

Layout **presets** — _Browsing_, _Building_, _Debugging_ — swap the whole
arrangement at once.

## Staying current

WebDeck looks for a newer release when it starts and once a day after that, on
the channel this build is on (a stable build only hears about stable releases).
When there is one, an **Update** chip appears beside **Ask**; click it for the
notes. **Update now** downloads the build into your Downloads folder, checks it
against the release's published checksum, unpacks it and shows it in Finder —
drag it to Applications, replace the old one, and relaunch. Nothing is
downloaded until you ask. Under
**Settings → Application → About** you can see when it last checked, why a
check failed, and press **Check now**.

## Keyboard shortcuts

| Shortcut            | Action                                                                          |
| :------------------ | :------------------------------------------------------------------------------ |
| **⌘D**              | Reveal / hide the Dev Deck (from anywhere, page focused or not)                 |
| **⌘⌥D**             | Bookmark this tab                                                               |
| **⌘T**              | New browser tab — the start page: address field, top sites, bookmarks, projects |
| **⌘W**              | Close the active tab                                                            |
| **⌘L**              | Focus the address bar                                                           |
| **⌘⇧T**             | Reopen the last closed tab                                                      |
| **⌘1–9**, **⌘⇧[ ]** | Switch tabs                                                                     |
| **⌘⇧L**             | Toggle light / dark theme                                                       |
| **⌘0**              | Reset page zoom to 100%                                                         |

The full set — back/forward/reload, find in page, print, new window, reopen closed
tab, per-tab devtools — is wired into the native application menu (File / Edit /
View / History / Window / Help) and the right-click context menu on any page.

## Windows and vertical tabs

- The **Deck** can leave the window: the pop-out button in the Deck's toolbar
  detaches it into its own window, and **Dock back** returns it. Any stack of
  blocks can float into its own window the same way.
- **Vertical tabs**: the layout toggle at the end of the tab strip turns the tabs
  into a rail block docked beside the page, with tab groups as sections. The
  toolbar moves up into the title bar, so the mode costs no extra height.

## Verify a build the way CI does

From `app/`:

```bash
npm run lint && npm run typecheck && npm test
npm run verify:patches
npm run verify:fork -- --browser "<path to Arcwel WebDeck.app>/Contents/MacOS/Arcwel WebDeck"
npm run verify:hardening -- --browser "<same binary>" --release
```

`verify:fork` boots the real browser, opens a project and exports a document;
`verify:hardening` measures the sandbox, site isolation and the `chrome://webdeck`
CSP on the running binary. Together they are the check that matters before a push.

## Next

- [Permission Modes](permission-modes.md) — how the agent is gated, and how to
  loosen or tighten it.
- [Agent Workflows](agent-workflows.md) — planning, approval, execution, and
  managing conversations.
- [Document Studio](document-studio.md) — styled Markdown / data documents and
  slide decks.
