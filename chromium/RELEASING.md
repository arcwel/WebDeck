# Releasing Arcwel WebDeck

How a build becomes a DMG a tester can open. Every command that needs your Apple
Developer credentials is marked **[YOU]** — those cannot be run for you, and the
rest of the pipeline runs without them (producing an ad-hoc-signed build that
installs with one Gatekeeper step, fine for internal testing).

The analysis behind the build settings is in [SHIPPABLE.md](SHIPPABLE.md); this
is the procedure.

## The shape of it

A shipped WebDeck is one `.app` containing two programs that must both be sealed
under the same signature:

- **the browser** — the Chromium fork, built release-configured
- **`webdeck-core`** — the IDE/agent service, a self-contained executable the
  browser spawns (`Contents/MacOS/webdeck-core`, with `webdeck-core-runtime/`
  beside it)

Neither is distributable on its own. The steps below build each, put the core
inside the browser bundle, sign the whole thing, and wrap it in a DMG.

## Prerequisites

- macOS on Apple Silicon (arm64). This is the only target today.
- The Chromium checkout with depot_tools on `PATH`
  (`/Volumes/BG_Dev/WebDeck/`).
- Node and npm, for building the core and running the pipeline.

## 1. Build the core

```bash
cd app
npm ci
npm run build:core
```

Produces `app/out/core/webdeck-core` — a ~122 MB Mach-O with the JS sealed
inside a copy of the official Node runtime, plus `webdeck-core-runtime/` for the
native pieces that cannot live inside an executable (node-pty, the js-debug
adapter, reveal.js data). `npm run verify:core` proves it boots with no Node
installed and runs a real pty.

**Do not use the developer's Homebrew Node here.** `build:core` fetches the
official nodejs.org runtime deliberately: Homebrew's `node` is a stub over
dylibs in `/opt/homebrew` that would neither run on a tester's machine nor pass
Apple's library validation.

## 2. Build the browser, release-configured

The dev build is a component build with fatal DCHECKs — a tester would hit
crashes that are not real bugs. The release build fixes both.

The build config is recorded in
[`build/webdeck-release.args.gn`](build/webdeck-release.args.gn); do not type
it out here. A release build is that file **without the
`webdeck_dev_keychain = true` line**:

```bash
SRC=/Volumes/BG_Dev/WebDeck/chromium/src
grep -v '^webdeck_dev_keychain' ~/Projects/WebDeck/chromium/build/webdeck-release.args.gn \
  > "$SRC/out/webdeck-release/args.gn"
cd "$SRC" && gn gen out/webdeck-release
autoninja -C out/webdeck-release chrome -j 6
```

Never use `gn gen --args='…'` for this directory. It overwrites `args.gn`
wholesale, and a hand-typed list silently drops the macOS SDK pin that builds
under Xcode 27 need. `npm run verify:patches` reports which keychain mode the
live config is in and fails on any other difference from the recorded file.

Notes:

- `is_official_build = true` is what turns `dcheck_always_on` **off** — do not
  set that arg yourself, and do not set `dcheck_always_on = true`, which would
  silently re-disable PGO.
- `chrome_pgo_phase = 0` is required because this checkout has no PGO profiles.
  The cost is a browser measurably slower than stock Chrome; acceptable for
  testing, revisit before a real launch (see SHIPPABLE.md §4).
- **Generated Mojo bindings can go stale in one out dir and not the other.** The
  build is content-hashed (siso), so a `webdeck.mojom` restored with an old
  mtime (for example copied back from `chromium/patches`) may leave
  `out/webdeck-release`'s generated bindings at an older interface while the
  component build regenerates. The symptom is silent: `chrome://webdeck`'s
  renderer is killed at its first new Shell call (`Validation failed for
webdeck.mojom.Shell [UNKNOWN_METHOD]` in the browser log). After touching the
  mojom, force it:

  ```bash
  rm -rf out/webdeck-release/gen/chrome/browser/ui/webui/webdeck \
         out/webdeck-release/obj/chrome/browser/ui/webui/webdeck
  autoninja -C out/webdeck-release chrome
  ```

- This is a whole-program ThinLTO build. Expect **2–4 hours cold**, and every
  later source change re-runs the whole-program link (tens of minutes), not the
  ~3-minute incremental of the component build. Keep the component build
  (`out/webdeck`) for development; use the release build only for candidates.

Confirm the settings resolved as intended — `dcheck_always_on` never appears in
`args.gn`, so read the resolved values, not the file:

```bash
gn args out/webdeck-release --list --short | grep -E 'dcheck_always_on|is_official_build|is_component_build'
```

## 3. Pack the WebUI for the release build

The page's Mojo bindings must carry the message ids of the build that serves
them, and an official build scrambles them. Pack for the release dir, not the
component dir — `pack:webui:release` regenerates the bindings from
`out/webdeck-release`, rebuilds the bundle, and refuses to pack if they do not
match that build's `webdeck.mojom-shared-message-ids.h`:

```bash
cd /Volumes/BG_Dev/WebDeck/chromium/src
autoninja -C out/webdeck-release chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator
npm --prefix <repo>/app run pack:webui:release
autoninja -C out/webdeck-release chrome
```

After the release is cut, `npm run pack:webui` (no suffix) puts the component
build's bindings back for development.

## 4. Assemble the deliverable

From the repo root, with the release build finished:

```bash
APP="/Volumes/BG_Dev/WebDeck/chromium/src/out/webdeck-release/Arcwel WebDeck.app"

# Put the core inside the browser bundle.
node app/scripts/install-core.mjs --app "$APP"

# Prove it runs on a machine that has never seen the build tree.
node app/scripts/verify-deliverable.mjs --app "$APP"
```

`verify-deliverable` copies the bundle away from the build directory, strips the
environment to what a fresh Mac has, and runs it there. If it reports anything
under a ✗, a tester would hit exactly that and you would not — do not ship past
a red line.

## 5. Package and sign

```bash
npm --prefix app run package:fork -- --build-dir "$(dirname "$APP")" --out dist
```

With no credentials this **ad-hoc signs** the bundle — the browser, the core,
and every native file in the core's runtime — and produces a DMG under `dist/`.
An ad-hoc build installs, but Gatekeeper warns on first open (see §7). That is
the right artifact for internal testing.

### [YOU] Real signing and notarization

For a build that opens with no warning, the app must be signed with an Apple
**Developer ID Application** certificate and notarized by Apple. `package-fork`
does the whole thing; what it cannot do is obtain the credentials, because each
step needs a password.

Check where you stand:

```bash
cd app && npm run release:preflight
```

It reports three things and prints the exact fix for each:

1. **Apple Developer Program membership** — 99 USD/year,
   <https://developer.apple.com/programs>. This is the part with a waiting
   period; start here.
2. **A Developer ID Application certificate** in the login keychain. Xcode →
   Settings → Accounts → Manage Certificates → **+** → _Developer ID
   Application_. It must be created on this machine, or imported together with
   its private key. An _Apple Development_ or self-signed certificate signs
   happily and is refused by the notary service.
3. **A notarytool credential profile**, stored once in the keychain:

   ```bash
   # [YOU] — asks for an app-specific password, made at
   # https://account.apple.com → Sign-In and Security → App-Specific Passwords.
   # The Team ID is on https://developer.apple.com/account under Membership.
   xcrun notarytool store-credentials webdeck-notary \
     --apple-id you@example.com --team-id TEAMID
   ```

   Nothing in this repository reads that password. `package-fork` passes the
   profile _name_ to `notarytool`, and the keychain hands over the secret.

With all three in place, one command produces the installer:

```bash
cd app
npm run release:dmg -- \
  --build-dir /Volumes/BG_Dev/WebDeck/chromium/src/out/webdeck-release \
  --out /Volumes/BG_Dev/webdeck-rc1
```

That is `package-fork --identity auto --notary-profile webdeck-notary`, which:

- signs every Mach-O in the bundle inside-out with the hardened runtime and a
  secure timestamp — the browser, the helpers, the framework, `webdeck-core`
  and each native file in its runtime;
- submits the **app** to the notary service, waits, and staples the ticket;
- writes the release archive beside it — `Arcwel-WebDeck-<version>-arm64.zip`
  and `SHA256SUMS` — and the signed update manifest `update.json` (needs the
  release key, `app/release/README.md`); the in-app **Update now** downloads
  only a release whose manifest verifies. Upload all three with the DMG:
  `gh release upload v<version> <zip> <dmg> SHA256SUMS update.json`.
  `--rollout <percent>` stages the release; `--critical` marks one that must
  not be deferred;
- builds the DMG around the stapled app, signs the DMG, submits **it**, and
  staples that too;
- mounts the result and asserts `spctl` says _accepted, source=Notarized
  Developer ID_, and that `stapler validate` passes on the app inside the
  volume.

Stapling both is deliberate. Notarize only the disk image and the copy the user
drags to Applications carries no ticket, so Gatekeeper has to ask Apple over the
network on first launch — which fails for a tester who is offline or behind a
network that blocks it.

If notarization is rejected, the failure line carries the submission id:

```bash
xcrun notarytool log <submission-id> --keychain-profile webdeck-notary
```

### The development keychain must be off

`webdeck_dev_keychain = true` keeps the cookie/password key in a plaintext
0600 file in the profile instead of the login keychain (§8). That is a
convenience for unsigned local builds and must never leave the machine, so
`package-fork` refuses to call such a build distributable — it lists it as a
blocker unless you pass `--allow-dev-keychain`. Release builds set the arg to
`false`.

## 6. Give it to a tester

Hand over the DMG. To install: open it, drag **Arcwel WebDeck** to Applications.

## 7. What macOS says about an unsigned build

An ad-hoc / unsigned build is not notarized, so on first open Gatekeeper shows
_"Arcwel WebDeck can't be opened because Apple cannot check it for malicious
software."_ The correct handling for an internal tester — **not** disabling
Gatekeeper system-wide:

1. Open the app once. The warning appears; dismiss it.
2. **System Settings → Privacy & Security**, scroll to the message naming Arcwel
   WebDeck, click **Open Anyway**.
3. Confirm once more. macOS remembers the choice for this app.

Tell testers this is expected for an internal build and will go away once the
app is notarized (§5 [YOU]).

## 8. The keychain prompt ("wants to use the Arcwel WebDeck Safe Storage key")

Chromium keeps the key that encrypts cookies and saved passwords in the login
keychain, under an item named _Arcwel WebDeck Safe Storage_. macOS lets an app
read its own keychain item without asking only when it can bind the item's
access control to a stable code identity. A notarized app has a Team ID and
binds cleanly. An ad-hoc build has none — macOS binds to the code hash instead,
which works **only if two things hold**:

- **The app runs from a stable path.** A quarantined un-notarized app launched
  from the DMG or Downloads is _App-Translocated_ — macOS runs it from a random
  read-only path that changes each launch, so the binding never matches and the
  prompt returns every time. **Dragging the app to /Applications in Finder clears
  translocation** (this is why §6 says drag to Applications, not run-in-place).
- **The binary does not change.** Every rebuild produces a new code hash, so a
  keychain item created by a previous build no longer matches. During
  development this is why the prompt reappears after each build.

So for a tester on a **single delivered build installed to /Applications**: the
prompt appears **once**, they click **Always Allow**, and it does not return.

If a machine was used to run _several_ builds (e.g. this one), a stale item from
an earlier build's hash lingers and prompts on every launch. Clear it once:

```bash
security delete-generic-password -s "Arcwel WebDeck Safe Storage" 2>/dev/null || true
```

The next launch of the installed app recreates it, bound to that build's hash,
and prompts once more (Always Allow) — then it is quiet.

**Do not "fix" this with `--use-mock-keychain`.** That switch routes OSCrypt to
an in-memory fake keychain whose key is regenerated every launch, which makes
every previously stored cookie and password undecryptable on the next start —
it silently logs the user out of everything on each run. Notarization (§5 [YOU])
is the change that removes the prompt for a shipped build, because a Team ID
gives the keychain a stable identity to bind to.

**For development builds** the fork carries a third option: the gn arg
`webdeck_dev_keychain = true` (`components/os_crypt/webdeck/dev_keychain.gni`,
off by default). With it, a bundle that has **no Team Identifier** keeps its
OSCrypt password in a random-once, then stable 0600 file `WebDeck Dev Keychain`
in the profile directory, so no prompt appears and nothing is logged out between
rebuilds. A Developer ID build never takes that path; `WEBDECK_REAL_KEYCHAIN=1`
forces the real keychain on any build. The cost is stated plainly: on such a
build the key is a plaintext file readable by any process running as the user.
`verify:hardening --release` warns when the arg is on and when the bundle has no
Team Identifier, so it cannot ship unnoticed.

## What still needs deciding before a real launch

Not blockers for testing, but named so they are not forgotten (SHIPPABLE.md has
the detail):

- **No auto-update.** `enable_updater = false`; there is no way to push a fix to
  a tester once they have the DMG. Each build is a fresh download.
- **No PGO**, so the browser is slower than stock Chrome.
- **Apple Silicon only, deliberately.** Intel Macs are out of scope; Windows
  and Linux come first when the platform list grows.
- **No media codecs.** `proprietary_codecs = false` → no H.264/AAC; a
  patent-licensing decision, not a build flag.
- **Rebasing on upstream security fixes** means a 2–4 hour build within days of
  each Chromium CVE. `npm run upstream:check` reports when we fall behind.

## Update size, measured

Every bump is a full download today. What a 0.1.5 build carries (unpacked):

| Part                                | Size   | Changes when                                            |
| :---------------------------------- | :----- | :------------------------------------------------------ |
| Arcwel WebDeck Framework binary     | 261 MB | every Chromium rebuild                                  |
| framework Resources (paks, locales) | 89 MB  | every Chromium rebuild; the shell bundle is 26 MB of it |
| webdeck-core                        | 117 MB | every core change                                       |
| helpers and libraries               | 24 MB  | rarely                                                  |
| the zip                             | 244 MB | —                                                       |

Two conclusions, so nobody re-derives them:

- **A core-only or shell-only update is not a delta we can ship.** The bundle
  is sealed by its signature as a whole; replacing files inside it on a user's
  machine invalidates the seal, and re-signing there needs the identity we do
  not ship. Any smaller update would have to be a whole new signed bundle.
- **A binary diff of the framework saves little.** A Chromium point release
  rewrites most of a 261 MB binary; measured bsdiff savings on Chromium
  frameworks are a few percent, for a tool we would have to ship and trust. The
  honest baseline stays: one 244 MB zip per release, staged by rollout when a
  release is risky, with the previous release one click away.

## Rebasing onto a newer Chromium

`npm run rebase:fork -- --to <version> --check` says whether the patch set
applies to the new tag without touching the working tree; `--apply` branches
at the tag, applies with three-way merge, copies the new-file trees and
updates `chromium/fork.json`. The workflow `.github/workflows/rebase-fork.yml`
runs both, then the pack, the build and the three gates, on a self-hosted
runner. `npm run upstream:check` now also reports the security fixes Chrome
announced between our pin and upstream, so "behind" comes with a severity.
