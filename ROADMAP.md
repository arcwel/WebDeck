# Arcwel WebDeck — Feature Roadmap (post-fork)

This is the plan for the **big bets** and **high-impact** features, now with the
state of each one. Every status below comes from reading the code and
`CHANGELOG.md` as of v0.1.7, not from memory. An item counts as **shipped** only
when the code that does it is in the repo. Paths are relative to the repo root.

The work still to do is collected under [Remaining](#remaining). Each line there
has its own acceptance criterion.

Status key:

- **shipped**: the roadmap task is in the code as written, or it is met by
  another route that the notes name.
- **partial**: some of it is built. The notes say which part is missing.
- **not started**: no code for it exists. The notes say what was searched.

Effort key: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks · **XL** ≈ 3+ weeks.

---

## Status

### Phase A — AI integrations (the lead)

These six items had not been confirmed. Code inspection settles them: the
item-level rows (A1–A4) give each verdict, and the numbered rows under them
break it down task by task.

| Item | What | Status | Evidence |
|------|------|--------|----------|
| A1 | AI-native omnibox (M) | partial | Ask row and streamed answer exist; no action rows, no Tab/Enter flow — see A1.1–A1.4 |
| A1.1 | "Ask" affordance + question heuristic | partial | `app/src/renderer/src/omnibox-rank.ts` (`looksLikeQuestion`, `askSuggestion`), `app/src/renderer/src/components/Omnibox.tsx`, `pickSuggestion` in `app/src/renderer/src/components/Toolbar.tsx`. The row is offered but not preselected, so Enter on a question still searches. It calls a one-shot model (`askOmnibox` in `app/src/core/domains/agent.ts`), not an agent session |
| A1.2 | Stream the answer into the dropdown, with citations | shipped | `app/src/renderer/src/components/AiAnswer.tsx`; `askOmnibox`, `ASK_SYSTEM` and `extractSources` in `app/src/core/domains/agent.ts`; CHANGELOG v0.1.3 "Ask Gemini." (the Gemini path returns no sources) |
| A1.3 | Proposed "action" rows, policy-gated | not started | `app/src/core/domains/agent.ts` (comment above `askOmnibox`: actions "deferred"); there is no action kind in `SuggestionKind` (`app/src/renderer/src/omnibox-rank.ts`) |
| A1.4 | Tab accepts an action, Enter sends | not started | `handleAddressKeyDown` in `app/src/renderer/src/components/Toolbar.tsx` handles only arrows, Enter and Escape, and swallows Enter while the answer is open |
| A2 | Agent drives the browser end to end (L) | partial | Tool surface and gating ship; there is no submit/click policy kind, no on-page overlay and no UI for "act as me" — see A2.1–A2.4 |
| A2.1 | Tool surface over CDP: open, read, click, type, wait, screenshot | shipped | `browser_open`/`browser_read`/`browser_click`/`browser_type`/`browser_wait_for`/`browser_screenshot` in `app/src/core/domains/agent.ts`; `app/src/core/agent-browser-port.ts`; `app/src/core/chromium-agent-browser.ts`; `app/src/core/page-agent-browser.ts`; CHANGELOG v0.1.0 "Autonomous browser control and verification" |
| A2.2 | Every side-effecting action is policy-gated | partial | `gate`/`gateInteraction` in `app/src/core/domains/agent.ts` and `checkAction`/`guardFor` in `app/src/core/domains/policy.ts` gate click, type and eval against the page's site (CHANGELOG v0.1.3 "Guards reach injected script."). `PolicyActionKind` in `app/src/shared/ipc.ts` is still `file_write \| command \| browser_navigate`, with no `browser_click`/`browser_submit`. Credentials are guarded by site, not by field |
| A2.3 | Live overlay of what the agent is doing, on which tab | partial | `ActivityFeed` in `app/src/renderer/src/components/AgentsBlock.tsx` logs browser steps. There is no on-page highlight, the click/type lines do not name the tab, and there is no DOM before/after diff |
| A2.4 | Isolated profile by default; "act as me" as a remembered opt-in | partial | `agentBrowserMode` in `app/src/core/main.ts` defaults to isolated. Session mode is only `--agent-browser session` or `WEBDECK_AGENT_BROWSER`, with no UI and no remembered choice |
| A3 | Inline AI in the editor (M) | partial | ⌘I inline edit ships; there is no "chat with this file" and no review before multi-file writes — see A3.1–A3.3 |
| A3.1 | ⌘I on a selection → inline diff → accept/reject | shipped | `CtrlCmd+KeyI` action in `app/src/renderer/src/components/EditorBlock.tsx`; `app/src/renderer/src/components/InlineEdit.tsx` (`createDiffEditor`, accept/reject); `EDIT_SYSTEM` in `app/src/core/domains/agent.ts` |
| A3.2 | Side-panel chat with this file/repo | partial | `app/src/renderer/src/components/AssistantPanel.tsx` hosts the agent, which has `read_file`/`list_dir`/`search`. Nothing in the editor opens it with the active file or selection attached (`openAssistant` is called only from `app/src/renderer/src/ask-page.ts`) |
| A3.3 | Multi-file edits through guarded tools + diff review | partial | `write_file`/`move_file` are gated by `gate(…'file_write'…)` in `app/src/core/domains/agent.ts`. `EditDiffModal` in `app/src/renderer/src/components/AgentsBlock.tsx` shows a diff only after the write is applied, with no accept/reject before |
| A4 | Chat with the page (S–M) | partial | Q&A and Summarize ship; no entities or table/JSON extraction, no chunking — see A4.1–A4.3 |
| A4.1 | Deck "Page" block: summary, entities, extract to Document Studio | partial | `app/src/renderer/src/components/PageAssistantBlock.tsx` (Q&A, `onSummarize`); `chatWithPage` in `app/src/core/domains/agent.ts`. There is no key-entities view, no "extract as table/JSON" and no hand-off to `app/src/renderer/src/components/DocStudio.tsx` |
| A4.2 | Capture page text through the gated path | shipped | Met by another route: `pageText` in `app/src/webui/shell.ts` calls Mojo `GetPageText` (`chromium/patches/chrome/browser/ui/webui/webdeck/webdeck_shell.cc`), which reads body text in an isolated world. The `browser-vision.ts` the old plan named does not exist; `app/src/core/vision.ts` is network-body capture for the agent |
| A4.3 | Large pages: chunk + map-reduce | not started | `CHAT_PAGE_TEXT_CAP` in `app/src/core/domains/agent.ts` truncates at 100k characters and says "(truncated)" |

### Phase B — Other big bets

| Item | What | Status | Evidence |
|------|------|--------|----------|
| B1 | Chrome Web Store extensions (L) | partial | Install, update and management are Chromium's own `chrome://extensions` (SECURITY.md; `extList`/`extLoadPath` in `app/src/webui/ipc-adapter.ts` defer to it). WebDeck adds pinned action buttons and popups: `PinnedExtensions` in `app/src/renderer/src/components/Toolbar.tsx`, `GetExtensionActions`/`RunExtensionAction` in `webdeck.mojom`; CHANGELOG v0.1.3 "Pinned extensions now appear in the toolbar." Not verified: that a Web Store install works end to end in a release build |
| B2 | WebDeck's own settings sync, file-based (L) | partial | Engine in `app/src/core/domains/sync.ts`, last-writer-wins in `app/src/core/domains/sync-merge.ts`, UI in `app/src/renderer/src/components/SyncSettings.tsx`. Nothing in production calls `registerSyncSection` or `initSync` (only `registerSyncRpc` from `app/src/core/server.ts`), so no settings are actually synced. There is no encryption and no per-surface opt-in |
| B2b | Our own sync service on Chromium's protocol (XL) | partial | `sync/src/handler.mjs` (Commit, GetUpdates, progress markers, birthdays), `sync/src/store.mjs`, `sync/src/identity.mjs`, `sync/src/cli.mjs`; CHANGELOG v0.1.3 "A sync service that speaks Chromium's own sync protocol". Missing per `sync/README.md`: keystore/Nigori, sign-in pages, real authorisation, and a round trip with a real browser |
| B3 | Remote / SSH workspaces (XL) | not started | `app/src/core/main.ts` refuses a non-loopback `--host`; no SSH or remote-core code in `app/src` |
| B4 | Collaborative editing (XL) | not started | No Yjs/CRDT dependency in `app/package.json`; no presence or relay code in `app/src` |

### Phase C — High-impact

C3 and C5 had not been confirmed. Code inspection settles them: the rows C3 and
C5 give each verdict, and the lettered rows under them break it down by key task.

| Item | What | Status | Evidence |
|------|------|--------|----------|
| C1 | Python / Rust / Go language servers (M) | shipped | `SERVERS` in `app/src/core/domains/lsp.ts` (pyright, rust-analyzer, gopls); `RUNTIME_PACKAGES` in `app/scripts/build-core.mjs`; `app/scripts/fetch-lsp-bins.mjs`; `SERVER_LANGUAGES` in `app/src/renderer/src/lsp.ts`. Per-language `INIT_OPTIONS` there covers TypeScript only |
| C2 | Python / Go debug adapters (M) | shipped | `app/src/core/domains/debug.ts` (debugpy, Delve, lldb); `app/src/shared/debug-languages.ts`; `app/scripts/fetch-dap-bins.mjs`; CHANGELOG v0.1.6 "Python, Go, Rust, C and C++ debugging." |
| C3 | Native ad/tracker blocking (M) | partial | A global on/off blocker ships; there is no filter-list engine, no per-site toggle and no toolbar counter — see C3.a–C3.c. CHANGELOG v0.1.0 "Ad & tracker blocking" |
| C3.a | Filter-list engine or content-settings rules | partial | `chromium/patches/chrome/browser/ui/webui/webdeck/webdeck_adblock.cc`: `kBlockedDomains` (about 95 hand-picked domains), `WebDeckAdblockThrottle` cancels with `ERR_BLOCKED_BY_CLIENT`. No EasyList, no `HostContentSettingsMap`, no subresource filter. Toggle in `app/src/renderer/src/components/BrowsingControls.tsx` |
| C3.b | Per-site toggle | not started | `webdeck.mojom` has only `Get/SetAdblockEnabled` (global); no allowlist in `app/src` or `chromium/patches` |
| C3.c | Blocked counter in the toolbar | not started | `GetAdblockBlockedCount` is one process-wide total, shown only in Settings (`app/src/renderer/src/components/BrowsingControls.tsx`); no adblock button in `app/src/shared/toolbar-buttons.ts` |
| C4 | Workspace / session snapshots (S–M) | partial | `saveSnapshot`/`restoreSnapshot` in `app/src/renderer/src/store.ts`, `app/src/renderer/src/components/SnapshotPanel.tsx` (⌘⇧S), palette commands in `app/src/renderer/src/commands.ts`. There is no `webdeck snapshot` CLI, and snapshots live in page localStorage where a CLI cannot reach them |
| C5 | Reader mode (M) | partial | A reader view ships, but it is built on WebDeck's own text heuristic, not Chromium's DOM Distiller — see C5.a–C5.c. CHANGELOG v0.1.0 "Reader Mode" |
| C5.a | Enable the DOM Distiller service in the fork | not started | No `dom_distiller` or `distill` anywhere in `chromium/patches` or `chromium/build` |
| C5.b | Mojo `Distill(tab_id)` | not started | Absent from `webdeck.mojom` and `app/src/renderer/public/mojo/webdeck.mojom-webui.js`; the reader uses `GetPageText` instead |
| C5.c | Render distilled content in the stage | partial | `app/src/renderer/src/components/ReaderView.tsx` (mounted in `Stage.tsx`) renders `innerText` through `formatReaderContent` in `app/src/renderer/src/reader-format.ts`: short lines become headings, and images and links are lost |
| C6 | Jupyter notebook block (M) | partial | `app/src/core/domains/jupyter.ts` (connects to a running Jupyter Server, messaging protocol v5.3), `app/src/renderer/src/components/JupyterBlock.tsx` (code cells, run, interrupt, outputs); CHANGELOG v0.1.0 "Jupyter notebook block". No `.ipynb` open/save, no markdown cells, and the core starts no server |
| C7 | REST / GraphQL client block (S–M) | partial | `app/src/core/domains/rest.ts`, `app/src/renderer/src/components/RestClientBlock.tsx` (methods, headers, body, history, JSON tree); CHANGELOG v0.1.0 "REST/DB blocks". No GraphQL |
| C8 | DB client block (M) | partial | `app/src/core/domains/db.ts` (SQLite only, read-only by default), `app/src/renderer/src/components/DbClientBlock.tsx` (virtualized results via `useVirtualRows`). The query editor is a `<textarea>`, not Monaco. There is no connection manager, no Postgres/MySQL and no secrets vault |
| C9 | Git graph + PR review (M) | partial | Commit graph and side-by-side diff: `app/src/renderer/src/components/GitGraphBlock.tsx`, `gitLogGraph`/`gitShow` in `app/src/core/domains/git.ts`, `app/src/renderer/src/components/SourceControlBlock.tsx` (branch switcher). No PR view or review comments |

### CLI opportunities

The only core subcommand today is `webdeck-core models …` (`app/src/core/cli-models.ts`,
CHANGELOG v0.1.7 "`webdeck-core models`"), and the sync service has its own
`webdeck-sync` (`sync/src/cli.mjs`).

| Item | What | Status | Evidence |
|------|------|--------|----------|
| CLI1 | `webdeck build-dmg`: the whole core→pack→package→verify chain | not started | Separate scripts in `app/package.json` (`build:core`, `pack:webui`, `package:dmg`, `release:dmg`); `app/scripts/package-fork.mjs` runs none of the earlier steps |
| CLI2 | `webdeck new-lsp` / `new-dap` scaffolders | not started | Only fetchers: `app/scripts/fetch-lsp-bins.mjs`, `app/scripts/fetch-dap-bins.mjs` |
| CLI3 | `webdeck snapshot save\|restore` | not started | See C4: snapshots are renderer-only |
| CLI4 | `webdeck agent run "<task>"` (headless) | not started | `app/src/core/main.ts` dispatches only `models` |

---

## Remaining

Each line is one piece of work and what "done" means for it. Shipped work is
not repeated here.

**Phase A**

- **A1.1 Ask by default:** Enter on input that `looksLikeQuestion` accepts opens the answer panel and does not search. _Done when_ a Toolbar test types "how do tabs sync?" + Enter and asserts `AiAnswer` opens and no navigation happens.
- **A1.3 Action rows:** the answer can propose "open N tabs / summarize this page / run a task" rows, and each one goes through `checkAction`. _Done when_ a test shows a proposed action asks for confirmation under the default policy and runs only after it is accepted.
- **A1.4 Keyboard:** Tab accepts the highlighted action, and Enter sends a follow-up while the answer is open. _Done when_ `handleAddressKeyDown` handles both keys and a test covers each.
- **A2.2 Click/submit policy kinds:** add `browser_click` and `browser_submit` to `PolicyActionKind`, and refuse to type into password or card fields without a prompt. _Done when_ policy tests show a form submit and a password-field `browser_type` each produce a confirm under full autonomy.
- **A2.2 Untrusted page framing for the agent:** `browser_read` output and the agent system prompt treat page text as data, as chat-with-page already does. _Done when_ the framing is in the agent prompt and a test asserts `browser_read` results are wrapped.
- **A2.3 Live overlay:** the agent's current target is highlighted on the page, and every browser log line names its tab. _Done when_ the smoke test (`AGWEB_AGENT_MOCK=1`) sees the highlight and the tab title on a click step.
- **A2.4 "Act as me" opt-in:** a remembered per-profile setting picks session mode, replacing the flag/env var. _Done when_ the choice is a setting in File → Settings…, is read at core start, and is off by default.
- **A3.2 Chat with this file:** an editor command opens the Assistant panel with the active file and selection attached. _Done when_ the command exists in `app/src/renderer/src/commands.ts` and the panel's composer shows the file chip.
- **A3.3 Review before write:** multi-file agent edits are staged and shown as a diff set to accept or reject before they reach disk. _Done when_ a rejected edit leaves the file unchanged, tested in `agent.test.ts`.
- **A4.1 Entities + extract:** the Page block offers "key entities" and "extract as table/JSON", and the result opens in Document Studio. _Done when_ both buttons exist and an extracted JSON opens in a Document Studio tab.
- **A4.3 Large pages:** pages over the cap are chunked and map-reduced, not truncated. _Done when_ a 300k-character page is answered from every chunk (unit test on the chunker and reducer).

**Phase B**

- **B1 Web Store install check:** confirm that a Chrome Web Store install, update and removal work in a release build, and record the result in `chromium/SHIPPABLE.md`. _Done when_ that record exists. Build a WebDeck manager only if the check fails.
- **B2 Wire settings sync:** register the sections `docs/settings-sync.md` promises (browser settings, policy, AI model, theme) and call `initSync()` at core start. _Done when_ two cores sharing one `AGWEB_SYNC_FILE` exchange a theme change in a test.
- **B2 Encryption + per-surface opt-in:** encrypt the sync file with a key from the secrets vault, and turn each section on or off on its own. _Done when_ the file on disk is not readable as JSON and a disabled section is neither written nor applied.
- **B2b Finish the service:** keystore/Nigori, real authorisation, sign-in pages. _Done when_ a fork build pointed at it with `--sync-url` round-trips bookmarks between two profiles.
- **B3 Remote workspaces:** a `webdeck-core` peer over SSH serving fs and terminal first. _Done when_ a folder on a remote host opens in the Files block and a terminal runs there.
- **B4 Collaborative editing:** Yjs documents, presence and a relay. _Done when_ two windows on two machines edit one file and see each other's cursors. Sequence it after B2b and B3.

**Phase C**

- **C1 Per-language config:** `INIT_OPTIONS` entries and user settings for pyright, rust-analyzer and gopls. _Done when_ a Python interpreter path set in settings reaches pyright's initialize request.
- **C3.a Filter lists:** replace the fixed host set with an EasyList-derived list loaded from a bundled resource. _Done when_ the list is a resource the build updates, and a known EasyList-only host is blocked.
- **C3.b Per-site toggle:** allow ads on a site, kept per profile. _Done when_ a site on the allowlist loads a blocked host and the others do not.
- **C3.c Toolbar counter:** a per-tab blocked count on a toolbar button listed in `app/src/shared/toolbar-buttons.ts`. _Done when_ the badge shows the current tab's count and resets on navigation.
- **C4 Snapshot CLI:** move snapshots from localStorage to the core, then add `webdeck-core snapshot save|restore <name>`. _Done when_ a snapshot saved in the UI restores from the CLI.
- **C5 DOM Distiller:** enable the distiller in the fork, add Mojo `Distill(tab_id)`, and render its article HTML (images, links) in `ReaderView`. _Done when_ `webdeck.mojom` has `Distill` and an article's images and links survive into the reader.
- **C6 Notebooks:** open and save `.ipynb`, add markdown cells, and optionally start a local Jupyter server. _Done when_ a notebook opened, run and saved round-trips through nbformat unchanged apart from outputs.
- **C7 GraphQL:** query + variables editor with schema introspection in the REST block. _Done when_ a request to a public GraphQL endpoint returns data in the JSON tree.
- **C8 DB connections:** a connection manager with Postgres and MySQL, credentials in the secrets vault, and a Monaco SQL editor. _Done when_ a saved Postgres connection's password is only in the vault and queries run from Monaco.
- **C9 PR review:** a PR list and view with review comments, using the existing diff. _Done when_ a GitHub PR's files and comments show in a block and a new comment can be posted.

**CLI**

- **CLI1 `build-dmg`:** _Done when_ one command runs core build → bindings → pack:webui → package → verify and stops at the first failure.
- **CLI2 `new-lsp` / `new-dap`:** _Done when_ the scaffolder adds a `SERVERS` (or adapter) entry plus its fetch step, and the result typechecks.
- **CLI4 `agent run`:** _Done when_ `webdeck-core agent run "<task>" --workspace <dir>` runs the agent headless under the policy file and exits non-zero on failure.

---

## Notes on the old plan

- Several files the earlier plan named do not exist: `extensions.ts` (Chromium
  owns extensions now) and `browser-vision.ts` (page text comes through
  `GetPageText`; `app/src/core/vision.ts` is the agent's network capture).
  The omnibox lives in `app/src/renderer/src/components/Omnibox.tsx` and
  `Toolbar.tsx`.
- `app/src/core/domains/jupyter.ts` calls itself "roadmap C10"; it is C6 here.
- Chrome Sync is closed to forks: browser sign-in and Google's sync endpoints
  need API keys and an OAuth client issued only to official Chrome builds. That
  is why B2b builds both the sync server and the identity endpoints.

## Sequencing

1. **Phase A gaps first**, cheapest first: A1.1 → A2.2 (safety) → A3.2 → A4.1 → A1.3/A1.4 → A2.3 → A3.3 → A4.3.
2. **B2 wiring**: it is small and makes a shipped-looking feature real.
3. **Phase C gaps** as capacity allows: C3 and C5 are the visible ones.
4. **Later:** B2b completion, then B3, then B4.
