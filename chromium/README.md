# `chrome://webdeck` — the fork's WebUI patch set

**Setting up from scratch?** [SETUP.md](SETUP.md) rebuilds the fork from a fresh
Chromium download using only this repo: the pinned version, the patch set and
the recorded build config.

The WebDeck bridge has two halves. **This directory is the fork half**: the
Chromium patches that add a `chrome://webdeck` page and spawn the core service.
The app half — the client that page talks to — lives in
`app/src/core/transports/ws-client.ts`.

## The macOS SDK this build needs

Xcode 27 ships an SDK whose `.tbd` stubs name targets (`arm64e.x1-macos`) that
the `lld` this Chromium pins cannot parse. Every link against `libSystem` fails
with `unknown target`, starting with the Rust host tools, so the build stops
before it compiles anything of ours. It is not a WebDeck change that breaks it —
updating Xcode is enough.

Until the fork rolls onto a Chromium whose toolchain understands that SDK
(`npm run rebase:fork`), build against the 26.5 SDK that Command Line Tools
still carries:

Keep a **writable copy** of it. Siso records and restores mtimes for every
file in the sysroot, and the copy Command Line Tools ships is owned by root, so
pointing the symlink straight at it builds until the next CLT update touches
those files and then fails with `failed to update mtime of … permission
denied`.

```bash
SRC=/Volumes/BG_Dev/webdeck-chromium/chromium/src
ditto /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk \
  /Volumes/BG_Dev/webdeck-chromium/sdks/MacOSX26.5.sdk
chmod -R u+w /Volumes/BG_Dev/webdeck-chromium/sdks/MacOSX26.5.sdk
ln -sfn /Volumes/BG_Dev/webdeck-chromium/sdks/MacOSX26.5.sdk \
  "$SRC/out/webdeck-release/sdk/xcode_links/MacOSX26.5.sdk"
# in out/webdeck-release/args.gn:
#   mac_sdk_path = "//out/webdeck-release/sdk/xcode_links/MacOSX26.5.sdk"
gn gen out/webdeck-release
```

`mac_sdk_path` must be written in GN's own form and point inside the output
directory — the symlink farm is there for exactly this. Chromium uses its own
bundled clang, so only the sysroot comes from that SDK; `actool` and the rest
still come from Xcode, which is why `DEVELOPER_DIR` is left alone.

Changing the SDK path rebuilds everything (about an hour here). The copy is
303 MB and outlives a `gn clean`, so it also covers Command Line Tools dropping
26.5 altogether.

## Status

**The real WebDeck UI runs on the fork.** `chrome://webdeck` serves the actual
application bundle (172 files, 18 MB), which builds `window.agweb` over a
WebSocket to `webdeck-core` and renders the full shell — tab strip, toolbar,
start page, Deck. Verified end to end over CDP, not inferred.

![chrome://webdeck connected to the core](../assets/chrome-webdeck-running.png)

```
Connected to webdeck-core.
permission mode: review
workspace: (none open)
port: 62458
```

| Piece                                             | Status                                               |
| :------------------------------------------------ | :--------------------------------------------------- |
| Core service (all IDE/agent domains, headless)    | Done, tested                                         |
| Standalone `webdeck-core` binary                  | Done, CI-verified end to end                         |
| WebUI client (`invoke`/`on` over WebSocket)       | Done, 11 tests against the real core                 |
| Resource pipeline (grit `.grd` → `.pak`)          | **Done — builds, packed, verified**                  |
| `WebDeckUI` controller + config registration      | **Done — compiles, host registered**                 |
| `WebDeckCoreService` (spawns core, reads port)    | **Done — spawns and reads the port**                 |
| Runtime verification (page loads, connects, RPCs) | **Done — verified over CDP**                         |
| Full WebDeck UI bundle on the page                | **Done — the real UI renders and talks to the core** |

### What is verified

- `gn gen` accepts the build graph (32,532 targets).
- `autoninja chrome` exits 0 with no errors.
- grit generated the ids and packed the resources — decoding
  `gen/chrome/webdeck_resources.pak` shows all three entries (gzip):
  `IDR_WEBDECK_WEBDECK_HTML` (654 B), `..._CSS` (1532 B), `..._JS` (3676 B).
- The `webdeck` host string is present in the built `libchrome_dll`.
- The page loads at `chrome://webdeck/` (title "WebDeck"), the browser spawned
  the core with `--port=0 --port-file=…`, the core published `{"port":62458}`,
  and the page completed `policy:get` and `workspace:current` over the socket.

### What is _not_ verified

- The page shown is the **boot page**, not the real WebDeck UI — that bundle is
  not packed yet.
- Only macOS arm64, only a component build, and only headless (`--headless=new`
  with remote debugging). A normal windowed launch has not been exercised.
- The core is reached through a dev **shim** (a shell script that runs the Node
  bundle), not a shipped executable.

## Layout

```
fork.json                              the pin + the patch manifest (machine-readable)
patches/
  branding.diff                        Chromium -> Arcwel WebDeck (product, company, bundle id)
  upstream-edits.diff                  the edits to existing Chromium files
  chrome/browser/ui/webui/webdeck/     WebDeckUI / WebDeckUIConfig      (new files, copied in)
  chrome/browser/webdeck/              WebDeckCoreService               (new files, copied in)
  chrome/browser/resources/webdeck/    README only — GENERATED, see below
```

`upstream-edits.diff` covers the seven files that had to change upstream:
the URL constant, the `WebUIConfig` registration, two `BUILD.gn` dep lists, the
resources group, the pak list, and the grit resource-id allocation.

`chrome/browser/resources/webdeck/` is **not** stored: it is the built UI
bundle (~174 files), regenerated by `npm run pack:webui`. Storing build output
would go stale within a day and hide which copy is authoritative.

### Reproducing the fork from this repo

```bash
git apply chromium/patches/branding.diff          # 1. brand it
git apply chromium/patches/upstream-edits.diff    # 2. edit the upstream files
cp -R chromium/patches/chrome/browser/ui/webui/webdeck  <src>/chrome/browser/ui/webui/
cp -R chromium/patches/chrome/browser/webdeck           <src>/chrome/browser/
npm --prefix app run pack:webui                   # 3. generate the UI resources
autoninja -C out/webdeck -j 6 chrome              # -j 6: higher races the drive
```

### Keeping it true

```bash
npm --prefix app run verify:patches
```

Asserts the repo still describes the checkout: every patch reverses cleanly
against it, the copied-in source trees match byte for byte, and every commit and
modified file in the checkout is covered by some patch. It exists because all
three silently stopped being true at once — the branding change lived only in
the checkout, `upstream-edits.diff` had drifted from the tree it was cut from,
and the stored `webdeck_ui.cc` was missing the `frame-src` CSP that lets
Reveal.js and Preview render. The browser still built, because the checkout was
right and the repo was the broken copy — and nothing was looking at the repo.
A rebase pipeline reads the repo, so run this before trusting one.

## Design notes

- **Pre-built assets, not `build_webui`.** That template compiles TypeScript and
  rejects `.js` in `static_files`; the WebDeck UI is bundled by the app's own
  toolchain. A plain grit `.grd` with `<include>` packs the built output as-is,
  so the same bundle runs under Electron today and the fork tomorrow.
- **Resource ids.** Registered in `tools/gritsettings/resource_ids.spec` at 2525
  with 20 slots — enough headroom for the real bundle's chunks.
- **Why a separate core process.** The IDE/agent logic is Node (pty, language
  servers, the debug adapter, the SDK). Keeping it out of the browser process
  means it restarts independently, does not enlarge the browser's attack
  surface, and is the _same_ service the Electron build runs — only the
  transport differs.
- **Port handoff via file, not stdout.** The core already supports
  `--port-file`, which avoids per-platform pipe plumbing entirely: the browser
  passes a path in a temp dir, then polls for `{"port":N}`. It also checks
  liveness with `WaitForExitWithTimeout(0)` (`Process::IsRunning` is
  Windows-only) so a core that dies is reported instead of hanging out the
  15 s timeout.
- **CSP.** The page may open a loopback WebSocket and nothing else
  (`connect-src 'self' ws://127.0.0.1:*`), and may not be framed
  (`frame-ancestors 'none'`).

## Remaining work

1. **Swap the boot page for the real UI bundle** — add the Vite output's files to
   the `.grd` and `BUILD.gn` inputs, and point the renderer at the WS client
   instead of the preload. The plumbing does not change; only the file list and
   the API wiring do. **This is what actually retires the Electron app.**
2. **Ship `webdeck-core` properly** — today a shell shim runs the Node bundle
   from the repo. It needs to be a real executable (bundled runtime or a signed
   launcher) installed beside the browser in `base::DIR_MODULE`.
3. **Start the core at browser startup** rather than on first page load, and call
   `Shutdown()` on exit — today it starts lazily when the page is first opened
   and is never torn down.
4. **Windowed + non-component build**, then the other platforms.

### Things found by actually running it

Three bugs that compiling could never have caught, each fixed:

- `--headless` refuses `chrome://` URLs without `--allow-chrome-scheme-url`.
- `UseStringsJs()` only _serves_ `strings.js`; the page must load it, and
  `load_time_data.js` is an **ES module** that exports `loadTimeData` rather than
  defining a global — so the classic-script approach silently yielded
  `undefined`. Replaced with a generated `core-port.js` that sets
  `window.WEBDECK_CORE_PORT`: one integer, no module plumbing, and it matches the
  contract `ws-client.ts` already implements.
- `webui::SetupWebUIDataSource()` sets its own `connect-src`, which silently
  overrode the WebSocket policy. The override must come _after_ it.
