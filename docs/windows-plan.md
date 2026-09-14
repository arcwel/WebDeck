# Windows: a development plan

A plan for shipping Arcwel WebDeck on Windows 11 (x64 first, arm64 when the
toolchain settles), with the same shell, Deck, agent, IDE layer, Document
Studio, local models and in-app updater the Mac build has. Nothing here is
built yet.

## What carries over unchanged

The fork was built on Chromium's cross-platform layers, so most of it is not
Mac code at all:

| Layer                                                            | Windows status                                                                                                |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| The shell page (`chrome://webdeck`, React, Vite)                 | Runs as is; only keyboard glyphs and a few paths need per-platform text                                       |
| The Mojo `Shell` and `AgentTabs` interfaces                      | Platform-neutral                                                                                              |
| `ContentsContainerView`, `BrowserView` and the staged-tab layout | Views code, the same on Windows                                                                               |
| The core (`webdeck-core`, Node single executable)                | Builds for win32; `node-pty` already ships `win32-x64` and `win32-arm64` prebuilds; ConPTY backs the terminal |
| Agent, policy engine, guards, local models, sync client          | Pure TypeScript                                                                                               |
| VS Code services (editor, LSP, DAP, extensions from Open VSX)    | The same packages VS Code ships on Windows; `lsp-bin/<platform>-<arch>` already keys on platform              |
| The sync and identity service (`sync/`)                          | Server side; untouched                                                                                        |
| The release checker and Update chip                              | Platform-neutral; only the download's unpack, reveal and quarantine steps are Mac calls today                 |

## What is Mac-only today, and its Windows counterpart

| Mac piece                                                                       | Windows counterpart                                                                                                                    |
| :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------- |
| `app-Info.plist`, `Assets.car`, `app.icns`, `LSFileQuarantineEnabled`           | `chrome/app/chrome_exe.rc`, `.ico` set, version resource; Mark-of-the-Web is applied by the browser's own download path                |
| `chrome_web_contents_view_delegate_views_mac.mm` (the page's file-drop path)    | `chrome_web_contents_view_delegate_views.cc` — the same hook, the views version; `BrowserRootView` drop path is already shared         |
| `global_keyboard_shortcuts_mac.mm`, `accelerators_cocoa.mm` (⌘ key equivalents) | `chrome/browser/ui/views/accelerator_table.cc` — Ctrl equivalents; the native menu becomes the shell's own menu (there is no menu bar) |
| `browser_native_widget_mac.mm` (traffic lights, title-bar inset)                | `BrowserFrameViewWin` / `BrowserNonClientFrameView`: draw the caption buttons on the shell's title row; DWM frame, snap layouts        |
| `keychain_password_mac.mm` and the dev keychain (`webdeck_dev_keychain`)        | Not needed: `os_crypt` on Windows is DPAPI, keyed to the user account, no prompt ever                                                  |
| `package-fork.mjs` (codesign, hdiutil, ditto, notarytool)                       | `package-fork-win.mjs`: Authenticode (`signtool`), zip via `tar`, an installer (Inno Setup or MSIX), the same `SHA256SUMS`             |
| Updater: `ditto -x -k`, `xattr -dr com.apple.quarantine`, `open -R`             | `tar -xf` (Windows 10+ ships bsdtar), strip the `Zone.Identifier` stream after the digest check, `explorer /select,`                   |
| `~/.webdeck`, `~/Downloads`                                                     | `%LOCALAPPDATA%\Arcwel WebDeck`, the Downloads known folder                                                                            |
| `security find-identity`, keychain-backed secrets in the core                   | Windows Credential Manager through the same `SecretStore` seam (`node-keystore.ts` gains a `wincred` backend)                          |
| `verify-hardening.mjs` (sandbox, site isolation, signature checks)              | The same checks with Windows answers: sandbox is on by default, `signtool verify`, no SIP equivalents                                  |

Everything in the second table is a file or a script, not a design change.

## Phases

Each phase ships behind the gates the Mac build uses, and is verified on a
real Windows machine (the CDP scripts in the verify loop work unchanged
against port 9333; window screenshots come from PowerShell) before it is
called done.

| Phase                       | Work                                                                                                                                                                                                                                                             | Proof it works                                                                                                                                    | Estimate |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------- |
| **0 — the build machine**   | A Windows 11 box or VM with 32 GB RAM and 250 GB free, Visual Studio 2022 Build Tools, the Windows SDK Chromium pins, depot_tools, a `webdeck-win` checkout on the same `153.0.8010.12` base; `fork.json` gains a per-platform checkout and out dir              | `autoninja chrome` finishes; an unbranded `chrome.exe` runs                                                                                       | 1 week   |
| **1 — the fork on Windows** | Apply `branding.diff` and `upstream-edits.diff`; split the Mac-only hunks into `patches/mac/` and add `patches/win/` for the drop delegate, accelerator table, frame view and resources; copy the new-file trees as is; `verify:patches` learns the split        | `chrome://webdeck` boots, the staged tab follows the stage, drops open Document Studio, ⌘ becomes Ctrl everywhere, the window has caption buttons | 2 weeks  |
| **2 — the core on Windows** | `build-core.mjs` produces a win32 SEA; paths and the keystore backend; ConPTY terminal; `lsp-bin/win32-x64`; the debug adapters; `install-core.mjs` puts `webdeck-core.exe` beside `chrome.exe`; `WebDeckCoreService` spawns it and reads the port file          | Every block works: files, terminal, LSP completions, a debug session, an agent run with tools, a local model through Ollama for Windows           | 2 weeks  |
| **3 — package and sign**    | `package-fork-win.mjs`: stage, sign every PE with `signtool`, zip, `SHA256SUMS`, an Inno Setup installer with a Start Menu entry and uninstaller; the privacy strings have no Windows analogue, so the guard becomes a signature-and-manifest guard              | A clean Windows machine installs from the installer and from the zip; SmartScreen's verdict is recorded honestly                                  | 1 week   |
| **4 — the updater**         | `pickAsset` learns `win32`; unpack with `tar`, strip Mark-of-the-Web after the digest check, reveal in Explorer; because a running `.exe` cannot be replaced, "Update now" ends with "Quit and install", which hands off to a tiny helper that swaps the folder  | A 0.x build fetches the next release from the real feed, verifies it, and comes back up as the new version with no dialog                         | 1 week   |
| **5 — release engineering** | GitHub Actions: `windows-latest` runs the app's lint, typecheck and tests on every push; the Chromium build stays on the self-hosted box; `RELEASING.md` gains the Windows section; the release carries `Arcwel-WebDeck-<v>-win-x64.zip`, the installer and sums | One `gh release create` with both platforms' assets; each platform's checker only ever offers its own                                             | 1 week   |
| **6 — arm64**               | `target_cpu = "arm64"`; the same package and updater paths with `-win-arm64` assets                                                                                                                                                                              | The same proofs on a Snapdragon machine                                                                                                           | 1 week   |

Nine weeks of focused work for x64, ten with arm64, on top of the build
machine. Phases 1 and 2 can run in parallel on two people.

## Signing and SmartScreen, stated up front

Windows has no notary. An unsigned or self-signed build opens behind a
SmartScreen warning ("Windows protected your PC" → More info → Run anyway),
the Windows cousin of the Mac's Open Anyway step, and the warning persists
until the publisher has built reputation. Two routes past it:

- **Azure Trusted Signing** — a monthly subscription, identity validation
  of the company, and reputation from day one because the certificate chains
  to Microsoft. The cheaper and simpler route if Arcwel's identity validates.
- **An EV code-signing certificate** — a hardware token, a few hundred
  dollars a year, immediate SmartScreen reputation.

Either way the build pipeline calls `signtool` with a certificate the
release machine holds; nothing in the repository changes between the two.
As on the Mac, the plan ships test builds first and says so in the notes.

## Risks

- **The frame.** Drawing tabs in the title row with Windows caption buttons
  and DWM snap layouts is the one piece of real UI work; Chromium's own
  Windows frame code is the reference and most of it is reused.
- **Two Chromium checkouts** double the disk and the rebase cost. The
  patch split in phase 1 is what keeps one rebase serving both.
- **Antivirus.** An unsigned `webdeck-core.exe` spawning terminals and a
  Node runtime is exactly what heuristics flag. Signing every PE, not just
  the browser, is not optional.
- **Long paths and reserved names** in the workspace file APIs; the core's
  path handling gets a Windows test pass.

## What is deliberately out

- An MSIX Store listing. Later, once the installer path is proven.
- Windows 10. Its DWM and ConPTY are older; the plan targets 11 and lets
  10 work if it happens to.
- Auto-update that replaces the app silently. Update now stays a fetch,
  a check and a hand-off the person triggers.

## CLI opportunities

- `webdeck build --platform win` — one command from checkout to `chrome.exe`,
  wrapping `gn gen` and `autoninja` with the fork's args. ~2 hours.
- `webdeck package --platform win` — the Windows counterpart of
  `package-fork`, with `--json`. Part of phase 3.
- `webdeck release --assets mac,win` — collects both platforms' assets and
  sums and runs the one `gh release create`. Part of phase 5.
