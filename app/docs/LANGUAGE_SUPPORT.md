# Language support (LSP + DAP)

How Arcwel WebDeck ships language intelligence, and how to add more. The backend
(`webdeck-core`, a Node Single Executable Application) owns every language-server
and debug-adapter process; the renderer speaks LSP/DAP to it over the existing
IPC channels. No renderer or IPC change is needed to add a language that fits the
patterns below.

## Two spawn models

WebDeck runs two kinds of language server, and the difference is the whole story
for adding one.

### A. Node-script servers (typescript, python)

The SEA makes a spawned **Node** tool work through exactly two mechanisms
(`scripts/build-core.mjs`):

1. **Require anchor.** Inside the SEA the ambient `require` resolves builtins
   only. The prologue rebinds `require`/`require.resolve` to a `createRequire`
   rooted at the unpacked `webdeck-core-runtime/` directory, and `lsp.ts`
   resolves servers through the same anchor (`WEBDECK_CORE_RUNTIME`). A package
   therefore only resolves if it was **copied into the runtime** by
   `RUNTIME_PACKAGES`.
2. **`ELECTRON_RUN_AS_NODE` argv shim.** Call sites spawn
   `process.execPath [entry, ...args]` with `ELECTRON_RUN_AS_NODE=1`. The
   prologue splices the duplicated executable path out of `argv` and re-enters as
   a plain `node <script> <args>`. This is why a **Node** tool spawned this way
   behaves like `node`.

A server that ships in the runtime but is not spawnable as Node, or is spawnable
but not shipped, silently reads as "not installed".

### B. Native-binary servers (go/gopls, rust/rust-analyzer)

A tool written in another language (Go, Rust) is a standalone executable — it
**cannot** be `require()`d and does **not** fit the `ELECTRON_RUN_AS_NODE` path.
It rides neither mechanism above. Instead it ships as a vendored binary under
`resources/lsp-bin/<tool>/<platform>-<arch>/<bin>` (exactly how the js-debug DAP
server is vendored under `resources/js-debug/`), and `lsp.ts` spawns it
**directly**: `spawn(command, args, { cwd })` — no `process.execPath`, no
`ELECTRON_RUN_AS_NODE`, no require-anchor. The on-disk path is resolved at spawn
via `coreEnv().appDir` (with `process.resourcesPath` and `process.cwd()`
fallbacks), the same lookup `debug.ts` uses for js-debug.

A native binary that was not vendored for the current platform reads as "not
installed" (graceful degradation) — the missing-file check is
`resolveNativeCommand` returning `null`, never a throw.

---

## Language servers (LSP) — `src/main/lsp.ts`

`ServerSpec` has two shapes, one per spawn model (above). A spec carries **either**
`module` (Node-script) **or** `command` (native binary), plus `args`:

```ts
interface NativeCommand {
  tool: string // vendor dir under resources/lsp-bin
  bin: string // executable name inside <platform>-<arch>/
}
interface ServerSpec {
  module?: string // Node-script: package entry, spawned via execPath
  command?: NativeCommand // native binary: spawned directly
  args: string[]
}

const SERVERS: Record<string, ServerSpec> = {
  typescript: { module: 'typescript-language-server/lib/cli.mjs', args: ['--stdio'] },
  python: { module: 'pyright/langserver.index.js', args: ['--stdio'] },
  rust: { command: { tool: 'rust-analyzer', bin: 'rust-analyzer' }, args: [] },
  go: { command: { tool: 'gopls', bin: 'gopls' }, args: [] }
}
```

`startLanguageServer` branches on which field is set:

- **`module`** → `resolveServer` resolves it through the runtime-anchored
  `createRequire`, then spawns `process.execPath [entry, ...args]` with
  `ELECTRON_RUN_AS_NODE=1`. Unchanged for typescript/python.
- **`command`** → `resolveNativeCommand` locates
  `resources/lsp-bin/<tool>/<platform>-<arch>/<bin>` and spawns it directly with
  `{ cwd }` — no execPath, no `ELECTRON_RUN_AS_NODE`. rust-analyzer and gopls both
  speak LSP on stdio by default, so `args` is empty.

Both paths return `{ error }` (never throw) when the server is missing, so a file
still opens without IntelliSense.

### Shipping a native-binary server — `scripts/fetch-lsp-bins.mjs` + `build-core.mjs`

Native servers are vendored, per-platform, by `scripts/fetch-lsp-bins.mjs`:

- **rust-analyzer** has an official prebuilt. The script downloads the pinned
  release asset `rust-analyzer-<triple>.gz` from `rust-lang/rust-analyzer`
  (verified: `rust-analyzer-aarch64-apple-darwin.gz` for darwin-arm64,
  `rust-analyzer-x86_64-apple-darwin.gz` for darwin-x64, the `-unknown-linux-gnu`
  variants for linux), gunzips it, `chmod +x`, and writes it to
  `resources/lsp-bin/rust-analyzer/<platform>-<arch>/rust-analyzer` with a
  `.version` stamp (sha256 recorded).
- **gopls** has **no** official prebuilt — the supported install is
  `go install golang.org/x/tools/gopls@latest`. If a Go toolchain is on `PATH`,
  the script builds it into `resources/lsp-bin/gopls/<platform>-<arch>/gopls`
  (via `GOBIN`); otherwise it **scaffolds the directory** and prints the exact
  manual command. See "Manually vendoring gopls" below.

`build-core.mjs` invokes `fetch-lsp-bins.mjs` during the SEA payload step, then
copies `resources/lsp-bin` into `webdeck-core-runtime/resources/lsp-bin` (beside
js-debug) and restores the execute bit on the binaries. **A failed or offline
fetch never fails the build** — the language degrades to "not installed" and the
framework ships regardless. Only the current platform-arch is fetched, so no
foreign Mach-O/ELF/PE lands in the bundle.

> **Notarization.** rust-analyzer is a foreign Mach-O (Team ID `rust_analyzer-…`,
> not Anthropic's). The download is ad-hoc signed, which is enough for dev builds:
> `package-fork` / Chromium's `sign_chrome.py` re-signs every part of the bundle,
> and an ad-hoc-signed, well-formed Mach-O re-signs cleanly. For a **notarized**
> release the binary must be Developer-ID-signed with the app's Team ID and
> covered by the hardened-runtime + notarization pass like every other executable
> part — the same requirement js-debug's pruned native addons carry.

#### Manually vendoring gopls

On a machine with Go:

```sh
GOBIN="$PWD/resources/lsp-bin/gopls/$(node -p 'process.platform+"-"+process.arch')" \
  go install golang.org/x/tools/gopls@latest
```

Then run a normal core build; `build-core.mjs` copies it into the runtime. Without
this, Go files open without IntelliSense (`go` reads as "not installed").

### Shipping a Node-script server into the SEA — `scripts/build-core.mjs`

Add the package to `RUNTIME_PACKAGES` with the minimum files needed:

```js
{ name: 'pyright', include: ['package.json', 'langserver.index.js', 'dist'] }
```

`include` is copied verbatim into `webdeck-core-runtime/node_modules/<name>/`.
Include `package.json` (establishes the package boundary for resolution), the
entry file, and whatever data the entry loads at runtime.

### Currently configured

| id           | model         | package / binary                            | entry / path                            | args      | notes                                                       |
| ------------ | ------------- | ------------------------------------------- | --------------------------------------- | --------- | ----------------------------------------------------------- |
| `typescript` | Node-script   | `typescript-language-server` + `typescript` | `lib/cli.mjs`                           | `--stdio` | both packages; tsserver pre-bundles its deps into `lib/`    |
| `python`     | Node-script   | `pyright`                                   | `langserver.index.js`                   | `--stdio` | self-contained; pyright pre-bundles everything into `dist/` |
| `rust`       | native binary | `rust-analyzer`                             | `lsp-bin/rust-analyzer/<plat>-<arch>/…` | (none)    | prebuilt download; vendored by `fetch-lsp-bins.mjs`         |
| `go`         | native binary | `gopls`                                     | `lsp-bin/gopls/<plat>-<arch>/gopls`     | (none)    | no prebuilt — `go install`; scaffolded if no Go toolchain   |

### Renderer wiring (one line, `src/renderer/src/lsp.ts`)

The backend above configures **which** servers exist. The renderer decides which
**Monaco language id** starts which server, via `SERVER_LANGUAGES` in
`src/renderer/src/lsp.ts` (consumed by `serverForLanguage`). `EditorBlock.tsx` is
generic — it calls `ensureLanguageClient(languageForPath(path))` for any language,
no per-language gate — and `monaco.ts`'s `EXT_LANGUAGES` now maps `go→go` and
`rs→rust`. To light a server up end-to-end, add its id there:

```ts
const SERVER_LANGUAGES: Record<string, string[]> = {
  typescript: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  rust: ['rust'], // add
  go: ['go'] // add
}
```

> This registry currently lists only `typescript` (python is in the same pending
> state). Adding the `rust`/`go` lines is the single remaining renderer step; it
> was left out of the CORE/build change because `src/renderer/src/lsp.ts` is owned
> outside this workstream.

**Pyright specifics (fully working):**

- Entry is the **top-level** `pyright/langserver.index.js`, not
  `dist/pyright-langserver.js`. `langserver.index.js` sets
  `global.__rootDirectory = __dirname + '/dist/'` before requiring the bundle;
  that global is how pyright locates its bundled `dist/typeshed-fallback/` Python
  stdlib stubs. Point at the inner bundle directly and typeshed resolution
  breaks.
- Dependency closure is the single `pyright` package. Its `package.json` declares
  **no** runtime `dependencies` — only an optional `fsevents` (a macOS
  file-watching speedup that `vscode-languageserver` already `require()`s inside
  a try/catch, so its absence degrades gracefully). This mirrors
  `typescript-language-server`, which pre-bundles its deps into `lib/`.
- `dist/` carries the bundled JS **and** `typeshed-fallback/` (~27 MB — required;
  it is the Python stdlib type information). The `.js.map` source maps in `dist/`
  are dead weight but the coarse directory-level `include` copies them along, the
  same way the tsserver `lib` include carries its maps.

### Verifying pyright boots in the SEA

The same recipe tsserver uses. After a core build
(`node scripts/build-core.mjs`), from `out/core/`:

```sh
# Resolves pyright/langserver.index.js from webdeck-core-runtime and speaks LSP.
# pyright-langserver has no --version; a raw --stdio launch waits for an LSP
# initialize request, so pipe one in and confirm a response comes back:
printf 'Content-Length: 119\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}' \
  | ELECTRON_RUN_AS_NODE=1 WEBDECK_CORE_RUNTIME="$PWD/webdeck-core-runtime" \
    ./webdeck-core "$PWD/webdeck-core-runtime/node_modules/pyright/langserver.index.js" --stdio
```

A healthy adapter prints `window/logMessage` "Pyright language server … starting"
followed by an `initialize` result carrying `capabilities`. (During development,
the identical check runs against `node` instead of `./webdeck-core`, resolving
from `node_modules/` — that is how this entry was validated.)

### Verifying a native-binary server (rust-analyzer)

A native binary needs neither the SEA nor `ELECTRON_RUN_AS_NODE` — `lsp.ts`
spawns it directly, so it is verified by running it directly. From the repo `app/`:

```sh
RA=resources/lsp-bin/rust-analyzer/darwin-arm64/rust-analyzer
file "$RA"          # → Mach-O 64-bit executable arm64
"$RA" --version     # → rust-analyzer 0.3.xxxx-standalone (…)

# Speaks LSP on stdio with no args (exactly how lsp.ts spawns it). Hold the pipe
# open until the initialize result comes back:
node -e '
  const { spawn } = require("child_process");
  const c = spawn(process.argv[1], [], { stdio: ["pipe","pipe","ignore"] });
  let out = ""; c.stdout.on("data", d => { out += d;
    if (out.includes("capabilities")) { console.log("LSP OK:", out.split("\r\n")[0]); c.kill(); } });
  const b = JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",
    params:{processId:process.pid,rootUri:null,capabilities:{}}});
  c.stdin.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`);
  setTimeout(() => c.kill(), 4000);
' "$RA"
```

A healthy binary reports its version and returns an `initialize` result carrying
`capabilities` (a ~2.8 KB `Content-Length` frame). This is the exact stdio
handshake `MonacoLanguageClient` performs once the renderer starts the server.

In the packaged app the same binary lives at
`webdeck-core-runtime/resources/lsp-bin/rust-analyzer/<plat>-<arch>/rust-analyzer`
and `resolveNativeCommand` finds it via `coreEnv().appDir`.

---

## Debug adapters (DAP) — `src/main/debug.ts`

The `ADAPTERS` registry records each language's adapter (kind, transport, note),
and `resolveDebugAdapter(id)` returns a concrete launch recipe
(`{ command, args, transport }`) or a clear error. Only the Node adapter
(js-debug) is fully wired through the socket transport in this module today; the
other entries are launch recipes plus availability guards, pending the transport
work below.

> **Wiring note.** The current `debugStart` IPC channel takes no language
> argument, so `startDebugSession()` always launches js-debug. Selecting a
> non-Node adapter (python/go/rust) needs a language-parameterized
> `debugStart` — that channel and the renderer UI are owned by other modules
> (`src/shared/ipc.ts`, `src/renderer/*`) and are intentionally untouched here.
> `resolveDebugAdapter` is the backend half, ready for that channel to call.

### 1. Node / browser — js-debug (fully working, bundled)

- **Source:** Microsoft **js-debug** GitHub release (MIT), vendored at install
  time into `resources/js-debug/` (see `scripts/fetch-js-debug.mjs`). The
  standalone `dapDebugServer.js` needs no extension host, which is what makes it
  shippable.
- **Runtime path:** copied into `webdeck-core-runtime/resources/js-debug/` by
  `build-core.mjs`; located at runtime via `coreEnv().appDir`. Foreign-platform
  `.node` addons are pruned so only this platform's native code remains (matters
  for codesign/notarization).
- **Spawn:** `process.execPath [.../dapDebugServer.js, '0', '127.0.0.1']` with
  `ELECTRON_RUN_AS_NODE=1`; the adapter prints its listening port and DAP flows
  over a TCP socket (parent/child sessions via `startDebugging` reverse
  requests).

### 2. Python — debugpy (scaffolded; interpreter dependency, not bundled)

- **Trade-off:** debugpy ships a DAP adapter (`debugpy.adapter`) but is a
  **Python** program. It cannot ride the `ELECTRON_RUN_AS_NODE` path the Node
  adapters use, so it is **not bundled** — it runs against the user's own
  interpreter and requires `pip install debugpy`. This is a deliberate
  interpreter dependency: bundling a Python runtime + debugpy would dwarf the
  app, and Python projects already need an interpreter to run.
- **Guard:** `findPython()` probes `python3` then `python` (`--version`, exit 0).
  If none is found, `resolveDebugAdapter('python')` returns a clear error
  (`… no python3 was found on PATH`) instead of throwing — debugging simply
  reports unavailable.
- **Spawn recipe:** `python3 -m debugpy.adapter` (stdio DAP). **Wired:** the
  core's stdio transport frames messages over the child's stdin/stdout
  (`openStdioConnection`), and `debugStart` carries the language id the
  renderer derives from the active file (`shared/debug-languages.ts`). Launch
  shape: `{ type: 'python', request: 'launch', program, cwd, justMyCode }`.

### 3. Go — Delve (wired; vendored on demand)

- **Binary source:** Delve (`dlv`), <https://github.com/go-delve/delve>, MIT.
  No prebuilt release binaries exist, so it is built with
  `go install github.com/go-delve/delve/cmd/dlv@latest` by
  `scripts/fetch-dap-bins.mjs` (`npm run fetch:dap -- --only delve`) on a machine
  with a Go toolchain, into `resources/dap-bin/delve/<platform>-<arch>/dlv`;
  `build-core.mjs` copies it into the runtime and restores its execute bit.
- **Also found:** `dlv` on PATH, and `~/go/bin/dlv` — so a developer who
  already has Delve needs nothing vendored.
- **Spawn:** `dlv dap --listen=127.0.0.1:0`; the core reads the port from
  Delve's `DAP server listening at: 127.0.0.1:<port>` line and connects over
  the same socket transport js-debug uses. Launch shape:
  `{ type: 'go', request: 'launch', mode: 'debug', program: <package dir>, cwd }`
  — Delve builds the package itself.
- **Not verified on a real Go program yet** (no Go toolchain on the build
  machine); the resolver and the banner parse are unit-tested with a fake
  `dlv`.

### 4. Rust, C, C++, Swift — lldb (wired)

Two adapters, tried in order:

- **codelldb** from the vscode-lldb releases, <https://github.com/vadimcn/codelldb>
  (MIT), vendored by `scripts/fetch-dap-bins.mjs` (`npm run fetch:dap -- --only
codelldb`): the release `.vsix` is downloaded, its sha256 checked against the
  pin in the script, and `extension/adapter` + `extension/lldb` unpacked to
  `resources/dap-bin/codelldb/<platform>-<arch>/`. About 150 MB unpacked, which
  is why the core build does not run this on its own. The copy VS Code's
  CodeLLDB extension installs (`~/.vscode/extensions/vadimcn.vscode-lldb-*`) is
  found too. Spawn: `codelldb --port 0`, port read from `Listening on port N`,
  socket transport. Launch shape for Rust: `{ type: 'lldb', request: 'launch',
cargo: { args: ['build'] }, cwd }` — codelldb builds and picks the binary; for
  C: `program` is a binary beside the source with the same stem.
- **lldb-dap**, which Xcode ships (`xcrun --find lldb-dap`) and LLVM installs put
  on PATH: nothing vendored, DAP over stdio. Launch shape:
  `{ type: 'lldb-dap', request: 'launch', program, cwd }` where `program` is
  `<workspace>/target/debug/<crate>` for Rust and `<dir>/<stem>` for C — build
  first (`cargo build`, or `clang -g hello.c -o hello`).

`rust-analyzer` remains the matching **LSP** (vendored by `fetch-lsp-bins.mjs`).

---

## Summary

| Language   | LSP                                                 | DAP                                                   |
| ---------- | --------------------------------------------------- | ----------------------------------------------------- |
| TypeScript | ✅ typescript-language-server (bundled)             | ✅ js-debug (bundled)                                 |
| Python     | ✅ pyright (bundled)                                | ✅ debugpy (system interpreter, stdio transport)      |
| Go         | 🟡 gopls (native binary; `go install`, scaffolded)  | 🟡 Delve (`fetch:dap` or on PATH; unverified on Go)   |
| Rust       | 🟡 rust-analyzer (native binary; prebuilt vendored) | ✅ lldb-dap (Xcode) or codelldb (`fetch:dap`/VS Code) |
| C / C++    | —                                                   | ✅ lldb-dap (Xcode) or codelldb                       |

🟡 for Go LSP: the **backend + vendoring are done** — gopls builds via
`go install` (scaffolded when no Go toolchain). Rust LSP: rust-analyzer is a
prebuilt download (auto-vendored). Follow-ups to reach ✅ end-to-end: (1) add
the `rust`/`go` lines to `SERVER_LANGUAGES` in `src/renderer/src/lsp.ts` (see
"Renderer wiring"), and (2) for Go, vendor gopls and Delve on a machine with Go
and run a real program under them.

✅ fully working · 🟡 scaffolded / documented, needs vendoring or transport wiring
</content>
</invoke>
