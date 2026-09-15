# Arcwel WebDeck Security Model

Threat-model review, originally for Phase 9 (task 9.7): the embed proxy,
extension loading, the agent runtime, and the trust boundaries between them.
Extended for the Chromium fork under task 13.8e.

> Reviewed and hardened after the v0.1 QA audit (see `QA_AUDIT.md`): the agent
> policy gate covers `browser_eval`, `browser_click` and `browser_type` and
> re-checks redirects; both local servers require a loopback `Host` and carry a
> capability token. Fixed findings are marked in that doc.

> **One product.** WebDeck is the forked Chromium: the application runs as
> `chrome://webdeck` inside it and talks to a standalone `webdeck-core`. The
> Electron shell was removed on 2026-09-02; nothing below describes it.

## The Chromium fork — where the boundaries now are

The fork (`chromium/`, pinned at 153.0.8010.12 in `fork.json`) serves the real
application bundle at `chrome://webdeck`, and that page talks to a standalone
`webdeck-core` process over a loopback WebSocket. Electron handed us Chromium's
defences by default; a fork means we own them, so this section states them as
measured rather than as assumed.

Five participants, in decreasing order of privilege:

1. **The browser process** — Chromium's own, unchanged. Renderers are
   sandboxed; site isolation is full.
2. **The `chrome://webdeck` page** — a WebUI renderer, sandboxed like any
   other, but holding two things no ordinary page has: the core's connection
   token, and a Mojo handle to `AgentTabs` (below).
3. **`webdeck-core`** — a plain Node process the browser launches. **Outside
   the sandbox, with the user's full privileges.**
4. **The agent** — runs inside the core, gated by `src/core/domains/policy.ts`.
5. **The pages the agent visits** — untrusted, and the source of every
   injection concern in this document.

The boundary between 1 and 2 is Chromium's, and it is measured rather than
assumed: `npm --prefix app run verify:hardening` launches the built browser and
reads the live process tree and the live page, because a `gn` arg or a stray
switch can turn any of this off with no visible symptom. On the current macOS
arm64 build it reports **14 passes, 0 failures, 3 warnings**: every renderer
holds a macOS seatbelt handle, `chrome://process-internals` reports Site Per
Process, a cross-site iframe really does land in its own renderer, and on the
page itself `eval` and an injected inline `<script>` are both _refused at
runtime_ — measured inside a same-origin worker, because a DevTools evaluation
is exempt from the page's CSP and would have passed either way. Against the development (component) build it also warns about the
unsandboxed core (next section), `is_component_build` and `dcheck_always_on`;
`--release` makes the last two hard failures, and the release build passes them.

The boundary between 2 and 3 is ours. It is the next two sections.

### webdeck-core is outside the sandbox — say it first

The core is the one part of the tree Chromium's sandbox does not cover, and it
is that way on purpose: it spawns ptys, reads and writes the workspace, runs
the debug adapter and the agent SDK, and holds the provider API key. Every one
of those is something the sandbox exists to deny, so the core could not be a
sandboxed child and still be the core. `verify-hardening` names it explicitly
rather than letting a page of ticks imply the whole tree is contained —
"outside the sandbox, with full user privileges: … `webdeck-core`".

The page is _allowed_ to reach it. `connect-src` on `chrome://webdeck` includes
`ws://127.0.0.1:*` and `ws://localhost:*` precisely so that socket can be
opened. So the honest statement of the residual is:

**A compromise of the `chrome://webdeck` page inherits the core's authority —
the user's filesystem, a terminal, the provider key, and the policy that gates
the agent. There is no second boundary behind that page.**

Everything that keeps the page from being compromised is a _preventive_
control, not a containment one: the bundle is entirely first-party, no remote
origin appears in `connect-src`, `eval` and injected inline script are refused,
`frame-ancestors 'none'`, and Trusted Types is required on script sinks. Those
are good controls. They are not a boundary, and nothing here should be read as
claiming one.

Two deliberate softenings of that page's CSP, both narrowing the statement
above rather than changing it:

- `trusted-types *` allows any policy **name** — Monaco derives dozens at
  runtime, so an allowlist of names would break on every Monaco upgrade — while
  keeping `require-trusted-types-for 'script'`. The sinks are still guarded;
  only the enumeration is given up.
- `connect-src` allows **any** loopback port, not just the core's, because the
  core's port is ephemeral and cannot be pinned in a static header. A page-level
  compromise could therefore address any local service, not only ours.

### The core socket: what the token buys, and what it does not

Two checks guard every connection, both at the HTTP upgrade, so a caller that
fails either never holds a socket (`transports/ws-server.ts`, `transports/auth.ts`):

- **A per-boot token** — 256 bits from the CSPRNG, base64url, compared in
  constant time. It rides in `Sec-WebSocket-Protocol`, not a query string,
  because a URL is the most copied, logged and forwarded part of a request; a
  header is the only carrier a page can set, since browsers refuse arbitrary
  WebSocket request headers. It is deliberately **not** printed to stdout, which
  the spawning process inherits.
- **The `Origin`** — `chrome://webdeck` and nothing else. A connection with no
  `Origin` at all is not a browser and is judged on its token alone; a page
  cannot omit or forge the header, so nothing is lost by that.

Both fail closed — absent is refused exactly like wrong. The token reaches the
browser only through the handoff file (mode `0600`, in a temp directory the
browser creates); a failure to write that file is fatal at boot rather than
swallowed, because a core whose token nobody has is a core nobody can talk to.
The browser re-validates what it reads (port in range, token at least 16
base64url characters) and emits it through a JSON writer rather than
`StringPrintf`, so a corrupt or hostile handoff cannot inject script into a
privileged page. `--host` is enforced loopback-only in the core's CLI, which
exits 2 on anything else — the docs claimed "loopback only" before anything
made it true.

**What this defends against:** any other local process dialling the port
(loopback is not a boundary — _any_ process on the machine can reach it, not
only this user's), and any web page the user happens to open attempting a
WebSocket to
`ws://127.0.0.1:<port>`. WebSocket is not subject to the same-origin policy, so
the port _is_ reachable from a random page; the `Origin` check is what makes
that reach useless.

**What this does not defend against:** anything that can already read the
user's own files. The token sits in a `0600` file this user can read, as does
the AES key file behind the standalone keystore. A process running as the user
is _inside_ the boundary, full stop. The token raises the bar from "any local
process" to "any local process that can read this user's files" — that is the
entire claim, and it is worth having, but it is not a claim about malware
running as the user.

### The agent acting as the user

`chromium-agent-browser.ts` defines two modes, because the right answer depends
on whether the page is trusted:

- **`isolated`** — a throwaway profile in a headless browser, no cookies, no
  ambient authority. An injected page can still lie to the agent, but it cannot
  act as the user.
- **`session`** — the user's own browser, their cookies and logins, in tabs
  they watch. This is the mode that matters for real work; it also means the
  agent acts _as_ the user, indistinguishable from the user to the site and in
  the site's logs.

**Today the fork still runs `isolated` only, and the reason is worth being
precise about, because the code no longer reads that way.** The module's header
comment says `session` is the default; the code defaults to `isolated`
(`chromium-agent-browser.ts`), and `server.ts` constructs the agent browser
without passing a mode at all. The `session` branch there also needs a CDP
endpoint (`sessionCdpPort` / `$WEBDECK_BROWSER_CDP_PORT`) that nothing
publishes. Read that comment as intent, not as behaviour.

The path the fork actually takes for session mode is different, and better: the
in-process Mojo interface in `webdeck.mojom` / `webdeck_agent_tabs.cc`. That
choice is a security decision worth recording. The other way to get CDP against
the user's real session is `--remote-debugging-port`, which is _unauthenticated
total control_ of that browser for any local process — upstream Chromium
blocked it on the default profile for exactly that reason. `AgentTabs` listens
on no socket; it is reachable only from the WebUI page, over a handle the
browser hands it. The chain is
`agent → core → [socket] → page → [Mojo] → browser → tab`, which is long, but
every link is one we already authenticate or already trust, and none of them is
a port.

Its scope is narrow by construction: only tabs opened through `OpenTab` are
addressable, so it cannot attach to a tab the user opened; the
`http`/`https`/`file` scheme allowlist is enforced in C++ as well as in the
core, so a page that talked to the interface directly gets no wider reach than
the agent has; and it uses `AttachClient` rather than `ForceAttachClient`, so it
fails loudly instead of silently displacing another debugger.

**The halves exist but are not joined.** `src/webui/agent-tabs.ts` serves the
`agent-tabs:*` reverse RPCs and `main.tsx` registers it; `src/core/page-agent-browser.ts`
implements the core-side driver, with the same navigation guard as the isolated
mode. But **nothing selects it** — `pageAgentBrowser` has no call site, and
`server.ts` still builds the isolated browser unconditionally. So the page will
answer calls no one makes, and the agent still gets a throwaway profile. This is
new, in-flight work; when the two halves are joined the agent begins acting as
the user, and this section needs rewriting rather than extending.

### What stops an injected page, and what does not

The policy gate (`src/core/domains/policy.ts`) is the backstop, and its precedence
order _is_ the security property: an explicit per-site **deny** first (nothing,
including full autonomy, overrides it), then a per-site **allow** (which also
lifts the guards — they exist to catch sites the user has not considered, not
to argue with ones they have), then the guards, then the mode.

The guards are five switches the user sets one by one — payments & checkout,
banking & brokerage, passwords & identity, email & messaging, posting publicly
— each backed by a host list (`GUARD_HOSTS`) and, for payments and posting, a
path heuristic (a checkout-looking path; a new issue, pull request or release
on a code host). The first three are on by default. A guard is checked
wherever the agent touches a page, not only when it navigates: `browser_open`
and `browser_navigate` check the destination; `browser_click`, `browser_type`
and `browser_eval` check the page the tab is currently on before acting (an
eval used to pass only the command gate, which full autonomy allows — closed,
with an end-to-end test that drives all three on a guarded page under full
autonomy and expects a prompt for each); and a redirect or in-page navigation
onto a guarded page is stopped by the navigation guard. Every list is **a seed,
not categorisation**. There
is no way to enumerate every bank, broker or patient portal from a keyword, and
the code says so itself. A bank that is not on the list gets no special
treatment whatsoever. Its job is to make the highest-consequence destinations
stop and ask by default and to give the user somewhere to start; the real
protection is the user's own per-site decisions.

Gated, in the fork exactly as under Electron: `file_write` (writes, directory
creation, moves, deletes, screenshot paths), `command`, `browser_navigate`
(both `browser_open` and `browser_navigate`), and `browser_eval` — which is
gated as a `command`, because injected script runs with the page origin's full
powers and is therefore an egress channel.

**Not gated: `browser_click` and `browser_type`.** A click gets a _post hoc_
navigation re-check and nothing else; typing gets nothing at all. So a click
that submits a form or fires an XHR without navigating — "Confirm", "Send",
"Delete" — passes no gate in any mode, and neither does filling the form that
precedes it. In `isolated` mode that is bounded by having no cookies; when
session mode lands, it will not be. This is the sharpest edge in the current
design and it is not yet tracked as its own task.

The fork's navigation guard hangs off `Page.frameRequestedNavigation` and calls
`Page.stopLoading`. Note two differences from the Electron guard it replaces:
it **denies on a `confirm` verdict rather than prompting** (the model is told
afterwards through `takeBlockedNavigation`, so it is stricter but silently so),
and there is no test covering it — that it catches server-side 30x redirects as
completely as Electron's `will-redirect` did is asserted in a code comment and
is **unverified**.

Fail-closed behaviour is real and worth naming: a `confirm` verdict with no UI
attached denies and writes `[no prompt UI attached]` to the audit log rather
than hanging the agent, while an `allow` verdict still proceeds headless — the
distinction that lets the core run before a window is connected.

### Prompt injection, specifically

Page text read through `browser_read` re-enters the model as a tool result.
Nothing marks it as untrusted when it does.

As publicly described, the other agentic browsers converge on three
mitigations: **per-site permission** (the user grants a site before the agent
acts there), **screening of proposed actions** before they run, and **a second
model judging whether an action matches what the user actually asked for** —
Google has described a "User Alignment Critic" for Gemini in Chrome, and
Claude for Chrome describes site-level permissions, blocked site categories,
and confirmation on high-risk actions. Those are their published claims, not
things measured here; the point of citing them is the shape of the design, not
its effectiveness.

Of those, **we have the first and not the other two.** We have per-site allow
and deny with deny winning, a sensitive-host seed list, a policy gate on
writes, commands, navigation and `eval`, secret redaction on captured bodies
and console lines, a plan a human approves before execution, and an audit log.
We have **no** screening of the agent's proposed actions for injected
instructions, **no** second model checking alignment with the user's request,
and **no** provenance marking on page-derived text. This is unbuilt, not
partial — grepping the codebase for any such check finds nothing.

The residual, stated plainly. In `review` (the default), an injected page can
make the agent read anything in the workspace, write anywhere inside it without
asking, and click and type on any page it already has open; commands and
off-allowlist navigation are proposed to the user, so **the human is the
injection filter**. In `autonomous`, there is no filter: `decide()` returns
`allow` for every file write and every command with no prompt at all, and for
navigation once past the two navigation-only checks. For the filesystem and the
shell, **the audit log is the only record that anything happened** — and
`audit.jsonl` is plain JSONL with no tamper-evidence, written by the same
process an attacker would be driving. It is a record, not a control.

One escalation path is closed: a synced settings file cannot set `autonomous`.
`sanitizeSyncedPolicyMode` refuses it and audits the refusal, because a file in
a shared folder must not be able to mean "act as the user, without ever asking,
on every device they own".

## Process & trust boundaries

The Electron shell is gone (2026-09-02); there is one product, the fork.

- **The browser process** is Chromium's, with two WebDeck additions: the
  `chrome://webdeck` WebUI host (`webdeck_ui.cc`) and the `Shell`/`AgentTabs`
  Mojo interfaces (`webdeck_shell.cc`, `webdeck_agent_tabs.cc`). Both are
  bound only for `chrome://webdeck`; a web page has no path to either.
- **The `chrome://webdeck` renderer** runs under Chromium's WebUI CSP, tightened
  as described under _The fork_: no eval, no remote origin, framed by nobody,
  `require-trusted-types-for 'script'` with a **default Trusted Types policy**
  (`webui/main.tsx`) that admits script URLs only from `chrome://webdeck/` and
  same-origin blobs, and refuses HTML strings outright — with one door
  (`renderer/src/trusted-html.ts`): mermaid, which renders to markup in a
  scratch element, is let through for the duration of its own render. What it
  renders is parsed through a second, named policy (`webdeck-inert-parse`)
  that feeds only an inert DOMParser, then scrubbed and inserted as nodes
  (`svg-node.ts`), never as the string. `src/core/csp-policy.test.ts` reads
  the C++ and fails if any of that is loosened.
- **Web content** is ordinary Chromium tabs in the user's profile, with site
  isolation doing the work a separate partition used to describe;
  `verify:hardening` proves the sandbox and site isolation positively at
  runtime. Web permissions (camera, geolocation, …) are Chromium's own prompts.
- **`webdeck-core`** is the unsandboxed tier — see the section above. Its
  `window.agweb` surface is rebuilt on the WebSocket client; every RPC handler
  validates its inputs, and **workspace scoping** (`resolveInWorkspace`) pins
  every file and agent operation under the open workspace root.
- **Browser extensions** are Chromium's own, installed and managed at
  `chrome://extensions`. WebDeck does not carry its own extension loader; the
  editor extensions from Open VSX are a different system, isolated as described
  under _VS Code extensions_ below.

There is no embed proxy and no header rewriting anywhere in the fork:
`chrome://webdeck`'s `frame-src` admits `http://127.0.0.1:*` and
`http://localhost:*` so the Preview block and Reveal decks render, and nothing
touches any site's headers.

### VS Code extensions (task 12.8) — shipped, and the isolation model

VS Code extensions from Open VSX ship as of 12.8. The earlier deferral stood
on one requirement: third-party extension code must run on a **second,
unprivileged origin** — never in the page that holds the core token. Under
`file://` there was no second origin at all; under the fork, `chrome://webdeck`
is a real origin but a _more_ privileged one. The fork now provides the second
origin, so the prerequisite is met rather than loosened:

- **The extension host is cross-origin from the WebUI.** VS Code's web-worker
  extension host runs in an iframe on the core's loopback HTTP origin
  (`http://127.0.0.1:<port>`). `chrome://webdeck`'s `frame-src` already allows
  it (it is the slide/preview origin); the page re-points monaco-vscode-api's
  two host assets — the iframe page and the worker bundle — at that origin via
  `registerAssets` (`editor-extensions.ts`). Chromium site-isolates the origin
  into its own renderer (verified by `verify:hardening`'s cross-site OOPIF
  test), it carries no Mojo bindings and no core token, and the iframe's own
  CSP (`script-src 'self' … data: blob:`) is what allows the worker. Extension
  code therefore cannot reach `window.agweb`, the Shell, or the core socket
  except through VS Code's own extension API surface.
- **Declarative extensions never execute.** Themes, grammars, snippets,
  keymaps and icon themes are `contributes` data read by the workbench's own
  services; they need no host and get none. Files reach the workbench as
  `data:` URIs — `connect-src` forbids fetching the loopback origin from the
  WebUI, and that stays true; bytes arrive over the core's WebSocket instead.
- **Installation is a policy action.** `vsx:install` runs through
  `checkAction('command', …)`: Secure mode confirms, a deny rule blocks, and it
  is audited like any command. An extension is third-party code and is treated
  as such.
- **Supply is pinned to the registry.** Downloads are accepted only from
  `https://open-vsx.org/`, are size-capped, and are unpacked with extract-zip,
  which rejects zip-slip entries. The core stores bytes; it never executes
  anything from an extension.
- **`vsx:read` is path-contained.** It resolves only inside that extension's
  own directory (`containedPath`, covered by `vsx.test.ts`) and caps file size,
  so it cannot become a file-read primitive for the renderer.
- **Webviews are cross-origin too.** A custom editor is a webview, and its
  host page (`pre/index.html`, its service worker and `fake.html`) is served
  from the same loopback `/assets/*` route as the extension host, re-pointed
  there by `registerWebviewHost` (vscode-editors.ts) rather than loaded from
  `chrome://webdeck`. The iframe therefore carries no Mojo bindings and no
  core token; extension content reaches it only through VS Code's own
  webview protocol (the service worker answers resource fetches by asking
  the workbench). One origin serves every webview, so webviews from
  different extensions are not isolated from each other — the same trade a
  self-hosted VS Code for the Web makes without per-webview subdomains.
- **The loopback server's `/assets/*` is the one token-less route.** The
  capability token lives in the URL path and an origin cannot carry one, so
  the host assets cannot sit behind it. That is acceptable only because they
  are the app's own public frontend files — never workspace data — every other
  route stays token-gated, Host is still checked (DNS rebinding), and the path
  is contained to the assets directory. Do not add anything else to that route.

Residual risk: a code extension has whatever the VS Code extension API grants
a web extension (editor contents, workspace files through the file service).
That is the same trust boundary VS Code for the Web has; WebDeck adds the
policy gate at install time and the origin separation at run time, and does
not weaken either. Browser (MV3) extensions are a separate mechanism (Phase
2.4) and are unaffected.

## Workspace roots (task 3B.4)

Path containment is the boundary the whole app rests on, so it lives in one
function — `resolveInWorkspace` in `src/core/domains/fs.ts`. Multi-root widened what
that function accepts, and the rules were chosen to widen it as little as
possible:

- **Relative paths are unchanged.** They resolve against the primary root
  only. Every pre-existing caller therefore means exactly what it meant
  before; multi-root cannot silently retarget an old code path.
- **Absolute paths are the only way to reach another root**, and are accepted
  only if they land inside a folder the user granted. Anything else is
  refused, as before. This is not filesystem access.
- **A grant is explicit and human.** The only way to add a root is
  `workspace:add-root`, which always opens a folder picker. There is
  deliberately no path-taking variant, so no page, tool call, or agent action
  can widen the boundary — only a person choosing a folder.
- **Grants are per session and never persisted.** VS Code remembers workspace
  folders; we do not. Re-granting yesterday's folders at launch would widen
  the agent's reach without anyone deciding to that day. Opening a different
  project also clears them, since they were granted against the old one.
- **Pinning still wins.** A caller that passes an explicit `root` (every agent
  session does — it pins the workspace it started in) is confined to that
  root regardless of what has since been granted. An agent cannot reach a
  folder added after it started.
- **No root can be deleted through the file API**, not just the primary one.

**Residual risk**: a granted folder is fully readable and writable by the
agent for the rest of the session, subject to the same Phase 9 policy prompts
as the primary root. Granting a folder is therefore the same kind of decision
as approving a plan — it is bounded by the policy mode in force, not by the
folder being special. Revoking is one click in the Files block.

## Agent runtime — escape paths considered

The agent executes only through workspace-scoped tools; the Phase 9 policy
engine (`src/core/domains/policy.ts`) is the central gate:

- **File writes** resolve inside the workspace (traversal rejected at the fs
  layer) and pass the policy gate (`secure` confirms each; `review`/`agent`
  auto-approve inside the workspace).
- **Shell commands** run with the workspace as cwd but are _not_ OS-sandboxed
  — a command can touch anything the user can. This is why `review` (the
  default) and `secure` modes require explicit confirmation per command (or a
  per-session, per-kind grant), and why every decision is written to
  `userData/audit.jsonl`.
- **Browser navigation** by agents is gated: local targets (`localhost`,
  `data:`, `file:`, `about:`) auto-approve outside Secure mode (Secure confirms
  everything); external hosts need the mode's allowlist or a user confirmation.
  Under Electron, agent-driven tabs are real shell tabs the user watches live —
  **that is not true on the fork**, where the agent runs an isolated headless
  browser the user cannot see (see _The agent acting as the user_). Approval
  binds to the URL the tab _actually loads_: a `will-redirect`/`will-navigate`
  guard re-runs the policy on every redirect and in-page navigation and cancels
  the ones it would not have approved, so a 302 cannot walk the tab
  off-allowlist. The fork's equivalent guard, and how it differs, is described
  above.
- **Page-driving tools are partly gated.** `browser_eval` injects script into
  the page origin — an egress channel (fetch/beacon/`location`) — so it passes
  the same gate as a shell command. `browser_click` can drive navigation, so the
  navigation guard re-checks where the tab lands afterwards. But the click
  itself passes no gate, and `browser_type` passes none either: a click that
  submits or fires an XHR without navigating is ungated in every mode. See
  _What stops an injected page, and what does not_.
- **Agent file tools are pinned to the session's workspace.** Every read/write/
  list/search resolves against the workspace the session started in, not the
  live one, so opening another project mid-run cannot retarget an agent's writes.
- **Prompt-injection surface**: page text read via `browser_read`/
  `browser_eval` re-enters the model as tool results. The policy gate is the
  backstop: even a hijacked session cannot write outside the workspace, and
  cannot run commands or leave the allowlist unconfirmed in the default mode.
  That is the whole of the defence — there is no injection screening. See
  _Prompt injection, specifically_.
- **Plan approval** remains a hard gate: no filesystem or terminal execution
  before a human approves the plan.

## Local HTTP servers (preview + slides)

The static preview server and the slide server bind `127.0.0.1` on ephemeral
ports. Loopback binding does not stop DNS rebinding, so both require a literal
loopback `Host` header (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`)
and answer anything else with 403 — a rebound attacker hostname never matches.
The slide server additionally serves only deck files that exist on disk and
HTML-escapes every interpolated value.

Both are registered by the core (`registerDevServersRpc`, `registerSlidesRpc`),
so they behave identically on the fork; `chrome://webdeck`'s `frame-src` is what
lets their pages be framed, and it admits loopback only.

Both also carry a **per-server capability token** (`local-server-auth.ts`:
`mintServerToken` / `takeToken`), minted from the CSPRNG when the server starts
and required as the first path segment of every request. The `Host` check
defeats DNS rebinding; the token is what makes the port useless to any other
local process — the same reasoning as the core socket, applied to a server that
otherwise serves everything under the workspace root. The residual is that the
token rides in the URL the page frames, which is the only carrier an iframe
`src` has; it is loopback-only and lives as long as the server does.

## Audit trail

`userData/audit.jsonl` records every policy decision (automatic and human),
every web-permission decision, and mode changes, each stamped with the active
mode and timestamp. Session execution logs and artifacts (Phase 8) provide
the per-action evidence trail.

Two honest limits. It is plain JSONL with **no tamper-evidence**, appended by
the same process that would be under an attacker's control — so it is evidence
for a user reviewing what happened, not a control that stops anything. And
under `autonomous` it is the _only_ record of a file write or a shell command,
because nothing else in that mode produces one.

## WebDeck Sync (settings sync)

Sync reads a JSON file the user chooses and applies its sections to app
settings, permission policy, AI model, and theme. Trust and hardening:

- **Every applied value is validated** — the `policy` section reuses the exact
  validators the IPC path uses (`sanitizePolicyMode` / `sanitizeCustomRules`);
  `settings` goes through `sanitizePatch`; `model` is allowlisted; `theme` is a
  two-value literal. Malformed or unknown-shaped values are dropped, never
  partially applied. Section keys `__proto__`/`constructor`/`prototype` are
  ignored (no prototype pollution).
- **No silent security change** — a pull that applies anything raises a visible
  toast ("Settings updated from a synced device"), and policy changes also fire
  the normal policy-changed broadcast that updates the UI.
- **Atomic writes can't be redirected** — the temp file uses a random name and
  `O_EXCL` (`wx`), so a pre-planted symlink in a shared sync folder can't divert
  the write onto another file.
- **The top rung is out of reach.** `sanitizeSyncedPolicyMode` refuses a synced
  `autonomous` and audits the refusal, so a file in a shared folder can never
  mean "act as the user, without ever asking, on every device they own".
  Escalating to full autonomy has to be a local choice made in front of the
  person who owns the session.
- **Residual risk (documented):** the file is still trusted for its _content_ —
  anyone with write access to the chosen folder can set any other _valid_
  policy, including a more permissive one such as `agent` with a wide host
  allowlist, which applies on the next pull (with the toast above, but no
  confirmation). Keep the sync file in a private, non-shared location. A
  confirm-on-loosen prompt for policy specifically is planned follow-up.

## Agent Vision (browser instrumentation)

The agent records an agent-driven tab's network + console via CDP. Response
**bodies** are captured only for HTTP-error responses that are **same-origin**
with the tab's document (CDP can otherwise read cross-origin bodies the page
itself cannot, pre-CORS), and every captured body and console line is run
through a secret-redaction pass (tokens, keys, JWTs) before it can enter the
agent's context or the on-disk transcript. Request URLs themselves are recorded
un-redacted, so a secret placed in a URL query string is still visible to the
agent — the same exposure a person opening DevTools would have.

## Where API keys come from (user's choice)

Settings → AI offers two sources, and the panel states the trade-off rather than
leaving the user to infer it:

1. **Store in WebDeck** (default) — encrypted at rest: `safeStorage` (OS
   credential store) under Electron, the AES-GCM keystore below in the
   standalone core.
2. **Use my password manager** _(recommended)_ — WebDeck stores **nothing** and
   runs a per-provider command you configure (`op read op://…`, `pass show …`,
   `security find-generic-password -w -s …`, `vault read …`), using what it
   prints. This is the stronger option for the same reason git has
   `credential.helper`: your vault already gates access on an unlocked session,
   audits reads, and handles rotation — and a leaked WebDeck data directory then
   contains no key at all.

Hardening on the command path:

- **No shell.** The command line is tokenized to argv here, so `;`, `|`, `$(…)`
  and friends are literal arguments, not operators.
- **Never synced.** This setting names a command to execute, so it is
  deliberately excluded from WebDeck Sync — accepting it from a shared folder
  would be arbitrary code execution for anyone who can write there.
- **Failure is closed, not silent-plaintext.** A locked vault or missing binary
  yields no key; WebDeck falls back to the environment variable or reports the
  provider unconfigured. It never degrades to storing plaintext.
- Fetched values are cached in memory for 5 minutes so a vault unlock/touch
  isn't demanded on every call, and the cache is dropped whenever the
  configuration changes.

## Secret storage outside Electron (standalone `webdeck-core`)

Under Electron, provider API keys are encrypted with `safeStorage` (the OS
credential store). The standalone core the Chromium fork spawns has no such
facility, and `secrets.ts` refuses to write plaintext — so it encrypts with
**AES-256-GCM under a 32-byte key in a `0600` file** beside the data
(`src/core/node-keystore.ts`).

Be precise about what that buys: it protects the ciphertext wherever it travels
**without** the key file — a copied or cloud-synced `secrets.json`, a backup, a
support bundle, a disk image. It does **not** protect against an attacker who
can already read the user-data directory as this user, since the key file is
there too. That is weaker than an OS keychain (which can require a live unlocked
session) and stronger than the alternatives available in plain Node (plaintext,
or refusing to store a key at all). A malformed key file reports the store
unavailable rather than silently rotating and stranding every stored secret.
When the fork exposes a real keyring binding, that implementation replaces this
one behind the same `SecretStore` interface.

This is no longer the hypothetical branch: on the fork it is **the** path a
provider key takes. Its key file and the core's `0600` handoff token are both
protected by the same thing — POSIX file permissions on this user's own files —
so an attacker who can read one can read the other. That is a single limit, not
two layers, and it is the same one stated under _The core socket_ above.

## What the tests hold us to (security pass, 2026-09-02)

Each of these is a test that fails on drift, not a sentence in this file:

- **Every agent tool that writes, runs, navigates or types passes the policy
  gate**, and the model has no tool over the policy itself —
  `domains/agent-gate.test.ts` reads `agent.ts` and refuses a new handler
  without a `gate()` call unless it is added to the read-only allowlist.
  `domains/agent-execute.test.ts` drives the real gate to a denial.
- **The `chrome://webdeck` CSP** — no eval, no remote origin, `frame-ancestors
'none'`, `require-trusted-types-for` intact, workers only from self or
  same-origin blobs — `csp-policy.test.ts` reads `webdeck_ui.cc`.
- **Redaction on every path that can carry a secret into the agent's context**
  (captured bodies, console lines) — `vision-redact.test.ts`.
- **What Sync may carry** — `sync-boundary.test.ts` boots the core and pins the
  registered sections to a reviewed allowlist; nothing named like a secret, a
  key or a command source may ever register.
- **Every UI channel is served by the core or named as host-owned** —
  `coverage.test.ts`.
- **The core socket** — token + `Origin`, fail-closed — `transports/*.test.ts`.
- **Vendored artifacts are pinned by digest**: the Node runtime against its
  release `SHASUMS256.txt`, js-debug and rust-analyzer against digests recorded
  beside their versions in `scripts/fetch-*.mjs`; a changed asset under the same
  tag is refused.
- **The shipped configuration**: `verify:hardening --release` fails on a
  component build, fatal DCHECKs or a disabled sandbox; `package-fork.mjs`
  refuses to package a non-distributable build.

## Known gaps

Named rather than implied. A threat model that overstates coverage is worse
than none, so anything below is something we do **not** have today.

### The core

- **`webdeck-core` and the agent's commands are unsandboxed at the OS level**
  (see _webdeck-core is outside the sandbox_ above); seatbelt profiles for the
  core are future work. Commands run in their own process group so a timeout
  reaps the whole tree.
- **The audit log has no tamper-evidence.**
- **No injection screening on agent actions**, no alignment check, no
  provenance marking on page-derived text. The gate tests above prove an
  injected page cannot _escalate_ past the policy; they do not detect
  injection, and nothing does.
- **The core stops itself, not the browser.** `main.ts` watches its parent and
  exits when the browser is gone; `WebDeckCoreService::Shutdown()` still has no
  caller, so the stop is a few seconds late rather than immediate.

### The fork specifically

- **Ad-hoc signing only.** `package-fork.mjs` signs with `-`; there is no
  Developer ID, no notarisation, and the update manifest key (`release/`) is a
  development key. A user cannot yet tell our binary from someone else's.
- **`connect-src` on `chrome://webdeck` allows any loopback port**, not just the
  core's, because the core's port is ephemeral and a static header cannot pin it.
- **`trusted-types *`** allows any policy name; the default policy in
  `webui/main.tsx` is what restricts script URLs and HTML strings, so a
  page-side bug there — or a render left inside the mermaid door in
  `trusted-html.ts` — is a page-side bug in the CSP.
- **Only macOS arm64 has been measured.** `verify:hardening`'s renderer-sandbox
  evidence is macOS seatbelt-specific and reports `unverified` elsewhere.
- **The fork's navigation guard denies rather than prompting** on a `confirm`
  verdict.
- **Session mode is selectable, not default.** The core boots the agent
  browser in isolated mode unless started with session mode; when session mode
  is on the agent acts as the user in their own tabs, bounded only by the gate
  (every click and keystroke is gated, but "no cookies" no longer applies).
