# Setting up the fork from a fresh Chromium download

How to rebuild Arcwel WebDeck on a new drive or a new Mac, starting from
nothing but this repo. Everything the browser is made of is in git:

- the Chromium version, pinned in [`fork.json`](fork.json);
- the fork itself: `patches/branding.diff`, `patches/upstream-edits.diff` and
  the three new-file trees under `patches/`;
- the build config: [`build/webdeck-release.args.gn`](build/webdeck-release.args.gn).

What is not in git is generated: the Chromium source you download, the web UI
resources the pack step writes into it, and the build output. This page
regenerates all three in the one order that works.

**Budget:** the fetch transfers about 77 GB (measured 2026-09-23) and the cold
build takes about 3 hours. Plan for 250 GB free.

## The drive: APFS (Case-sensitive), nothing else

Chromium cannot live on ExFAT, and it fails quietly rather than loudly. Test
the volume before downloading 77 GB onto it:

```bash
T=/Volumes/YOURDRIVE/.fs-probe; rm -rf "$T"; mkdir -p "$T"
echo one > "$T/Case.txt"; echo two > "$T/case.txt"
[ "$(cat "$T/Case.txt")" = one ] && echo "PASS case-sensitive" || echo "FAIL case-insensitive"
ln "$T/Case.txt" "$T/hard" 2>/dev/null && echo "PASS hard links" || echo "FAIL hard links"
rm -rf "$T"
```

Both must pass. On ExFAT the second write silently replaces the first, so a
checkout is corrupt from the start, and `ln` fails because git and gclient use
hard links. ExFAT does support symlinks and exec bits on macOS, which is why it
looks usable until it is far too late.

## Where the checkout goes

`/Volumes/BG_Dev/WebDeck/chromium/src` today, and it is declared **once**, as
`checkout` in [`fork.json`](fork.json). `app/scripts/chromium-src.mjs` resolves
it for every script; `--chromium <path>` or `WEBDECK_CHROMIUM_SRC` override it
for one run. Moving to another drive is an edit to that one line.

## Before you wipe the old drive

- **Save the 26.5 SDK.** `$ROOT/sdks/MacOSX26.5.sdk`
  (303 MB) is the only SDK this Chromium can link against under Xcode 27.
  Command Line Tools still carries a copy today; the next update may not. Keep
  one somewhere that survives, and step 5 will copy from it.
- Push any unpushed commits in this repo. A fresh clone only has what is on
  `origin`.

## Prerequisites

- Xcode (Chromium still uses its `actool`) and Command Line Tools.
- **The Metal toolchain.** A fresh Xcode 27 does not include it, and ANGLE's
  shader step fails with `cannot execute tool 'metal' due to missing Metal
Toolchain`. It is an 839 MB download and needs no password:

  ```bash
  xcodebuild -downloadComponent MetalToolchain
  xcrun -f metal   # must print a path
  ```

- Node and npm, for `app/`.
- This repo cloned at `~/Projects/WebDeck`, with `npm ci` run in `app/`.

## Steps

The variables below are used throughout. Set them once per shell.

```bash
ROOT=/Volumes/BG_Dev/WebDeck
SRC=$ROOT/chromium/src
TAG=153.0.8010.12   # must match "base" in chromium/fork.json
export PATH="$ROOT/depot_tools:$PATH"
```

### 1. depot_tools

```bash
mkdir -p "$ROOT"
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$ROOT/depot_tools"
git config --global core.autocrlf false
export PATH="$ROOT/depot_tools:$PATH"
gclient --version    # bootstraps depot_tools; see below
```

**Run `gclient` once before `fetch`.** A freshly cloned depot_tools has not yet
downloaded its vendored Python, and `fetch` dies immediately with
`python3_bin_reldir.txt not found`. Any gclient invocation does the bootstrap.

### 2. Fetch Chromium

```bash
mkdir -p "$ROOT/chromium" && cd "$ROOT/chromium"
caffeinate -s fetch --nohooks chromium
```

Takes 30 to 90 minutes. Do not use `--no-history`: step 3 needs the tags.

### 3. Check out the pinned version

Always the tag in `fork.json`, never "the current stable". The old bootstrap
script resolved today's stable release, which builds a different browser from
the one the patches were cut against.

```bash
cd "$SRC"
git checkout -b "webdeck-base-$TAG" "tags/$TAG"
caffeinate -s gclient sync --with_branch_heads --with_tags -D --force --reset
caffeinate -s gclient runhooks
```

No `git fetch --tags` is needed: `fetch` in step 2 configures
`+refs/tags/*:refs/tags/*`, so all ~39,000 tags are already local. Running it
anyway stalls on ref negotiation — measured at 17 minutes having burnt 1.6
seconds of CPU, which looks exactly like a hang.

Then make sure the checkout is clean before the next step, which refuses to run
otherwise. A sync against a different revision can leave a stale dependency
directory behind (here, `third_party/chromium-bidi`, which this tag's DEPS does
not list); delete it.

The second `gclient sync` is not a repeat: it moves every dependency to the
revisions this tag pins.

### 4. Apply the fork

```bash
cd ~/Projects/WebDeck/app
node scripts/rebase-fork.mjs --to "$TAG" --check
node scripts/rebase-fork.mjs --to "$TAG" --apply
```

`--check` proves the patches apply before anything is touched. `--apply`
commits the branding, applies the upstream edits, and copies the new-file trees
into the checkout.

### 5. SDK pin and build config

```bash
SDK=$ROOT/sdks/MacOSX26.5.sdk
mkdir -p "$ROOT/sdks"
ditto /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk "$SDK"
chmod -R u+w "$SDK"

mkdir -p "$SRC/out/webdeck-release/sdk/xcode_links"
ln -sfn "$SDK" "$SRC/out/webdeck-release/sdk/xcode_links/MacOSX26.5.sdk"
cp ~/Projects/WebDeck/chromium/build/webdeck-release.args.gn "$SRC/out/webdeck-release/args.gn"
```

If Command Line Tools no longer has 26.5, `ditto` from the copy you saved
before wiping instead. The copy must be writable: siso restores mtimes across
the sysroot, and the Command Line Tools copy is root-owned, so pointing the
link straight at it builds until the next update and then fails with
`failed to update mtime … permission denied`.

### 6. Bootstrap the web UI, then generate the build

```bash
cd ~/Projects/WebDeck/app
npm run build:webui
node scripts/pack-webui.mjs --chromium "$SRC" --bootstrap
cd "$SRC" && gn gen out/webdeck-release
```

This is the step a fresh checkout cannot skip. The patched
`chrome/browser/resources/BUILD.gn` names the web UI's target, whose own
`BUILD.gn` is written by the pack step, so `gn gen` fails until it exists. But
the normal pack refuses to run until the build has generated the page's Mojo
bindings. `--bootstrap` writes the build files without that check, only so
`gn gen` can run. Never build a browser from a bootstrap pack; step 7 replaces
it.

### 7. Generate the Mojo bindings and pack for real

```bash
cd "$SRC"
autoninja -C out/webdeck-release chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator
autoninja -C out/webdeck-release gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-shared-message-ids.h
cd ~/Projects/WebDeck/app && npm run pack:webui:release
```

**Both** generator builds are needed. The first writes the TypeScript bindings
the page loads; the second writes the C++ message-id header the pack compares
them against. With only the first, the pack exits 2 with `ENOENT … webdeck.mojom-shared-message-ids.h`.

The bindings must come from this release directory. An official build
scrambles Mojo message ids per Chromium version, and bindings from any other
build send ids the browser rejects, killing the page at its first call. The
pack prints `mojo bindings match out/webdeck-release` when they agree.

### 8. Build Chromium

```bash
caffeinate -s autoninja -C "$SRC/out/webdeck-release" chrome -j 6
```

About 3 hours cold. `-j 6` is what the old drive needed: higher parallelism
raced on its I/O. Keep it until a new drive proves it can take more.
`autoninja` exits 0 even when the build fails, so read the last line: it must
say `The build has finished successfully.`

### 9. Core, signing, package, install

```bash
cd ~/Projects/WebDeck/app
npm run build:core
node scripts/install-core.mjs --app "$SRC/out/webdeck-release/Arcwel WebDeck.app"
npm run dev:signing-identity
node scripts/package-fork.mjs --build-dir "$SRC/out/webdeck-release" --out "$ROOT/webdeck-rc1" --keep-stage --identity "Arcwel WebDeck Dev" --allow-dev-keychain
```

`dev:signing-identity` creates the local signing keychain, or unlocks it after a
reboot. It stores its own password, so it never asks for yours.

Install the staged app. The old copy is removed only after the new one has
landed, so a failed copy never leaves you without a browser.

```bash
APP="/Applications/Arcwel WebDeck.app"
ditto "/Volumes/BG_Dev/WebDeck/webdeck-rc1/stage/Arcwel WebDeck.app" "$APP.new"
rm -rf "$APP" && mv "$APP.new" "$APP"
xattr -dr com.apple.quarantine "$APP"
```

### 10. Verify

```bash
cd ~/Projects/WebDeck/app && npm run verify:patches
```

Every line must pass, including **build config**, which confirms the args.gn
in the build directory is the one this repo records. Then launch the app and
check that the shell loads.

## After setup: day-to-day

| You changed               | Run                                                                        |
| :------------------------ | :------------------------------------------------------------------------- |
| Renderer or web UI code   | `npm run pack:webui:release`, step 8, then package and install from step 9 |
| `webdeck.mojom`           | The generator build from step 7 first, then the row above                  |
| The core (`app/src/core`) | `build:core` and `install-core` from step 9, then package and install      |
| A Chromium patch          | Step 8, then package and install                                           |

Use the `:release` script variants. `out/webdeck`, the old component build that
`npm run pack:webui` and a few defaults still name, is not recreated here and is
not needed.

After the first build, step 8 is incremental: minutes, not hours. Changing the
SDK path or `args.gn` invalidates everything and costs a cold build again.

To change the build config, edit `build/webdeck-release.args.gn`, copy it into
the build directory, and `gn gen`. `verify:patches` fails if the two differ, so
an edit made only in the build directory cannot quietly go missing.
