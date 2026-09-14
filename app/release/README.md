# Release update channel

The fork brings its own auto-update channel (TASKS.md 10.2). Chromium's updater
is Google-infrastructure-bound, so the client checks a **signed manifest** we
publish and refuses anything that does not verify against a pinned key — an
unsigned update channel is a remote-code-execution channel.

Tool: [`app/scripts/update-check.mjs`](../scripts/update-check.mjs) (`npm run update:check`).

## Keys

- `update-pubkey.pem` — the Ed25519 **public** key, committed here. The updater
  pins it; every manifest must verify against it.
- `update-signing-key.pem` — the **private** key. NEVER committed (gitignored).
  Whoever cuts releases holds it, ideally in a secret manager or a hardware key.

Mint the pair once:

```bash
node scripts/update-check.mjs --genkey ./release
# then commit release/update-pubkey.pem; store update-signing-key.pem securely
```

Rotating the key is a breaking change for already-installed clients (they pin
the old key), so a rotation ships in a build signed with the OLD key that
carries the NEW key — plan it, don't do it casually.

## Manifest

`package-fork` writes the release's manifest and, when the private key is
present (`--update-key`, `$WEBDECK_UPDATE_KEY`, or
`~/.webdeck/release/update-signing-key.pem`), signs it as `update.json`:

```jsonc
{
  "manifest": {
    "channel": "stable", // "pre" for a pre-release version
    "version": "0.1.6",
    "chromium": "153.0.8010.12", // the base the build was made from
    "rollout": 100, // percent of installs it is offered to
    "critical": false, // true: must not be deferred
    "assets": [{ "name": "Arcwel-WebDeck-0.1.6-arm64.zip", "sha256": "…", "size": 255725521 }]
  },
  "signature": "<base64 Ed25519 over canonicalize(manifest)>",
  "keyId": "<first 16 hex of sha256(update-pubkey.pem)>"
}
```

`update.json` is uploaded as a release asset beside the zip and `SHA256SUMS`.
The core fetches it for the newest release on its channel, verifies it against
the pinned key, and only then offers **Update now**; a release without a valid
manifest is shown with its page and nothing more. The signature covers a
canonical (sorted-key) serialization of `manifest`, so key order in the file
does not matter; the canonicalization in `scripts/update-check.mjs` and
`app/src/shared/update-signing.ts` must stay identical.

- **Security flag.** A `chromium` newer than the running build's, or
  `critical: true`, makes the Update chip say the release carries Chromium
  security fixes.
- **Staged rollout.** Each install has a stable bucket per version
  (`rolloutBucket`); a release with `rollout: 25` is offered to a quarter of
  installs and reported as "rolling out gradually" to the rest. Raise it by
  re-running the packager with `--rollout 100` and re-uploading `update.json`
  (the signature changes with the manifest, the assets do not).
- **Going back.** The checker also resolves the release just below the running
  one; Settings → Application → About offers it the same way.
