# webdeck-sync

A sync service that speaks Chromium's own sync protocol, so WebDeck can sync
bookmarks, preferences and the rest without Google.

## Why this exists

WebDeck is an unbranded Chromium fork. It has no Google API keys and no OAuth
client, so it cannot sign in to Google and cannot use Chrome Sync. That is not
a bug to fix; it is what being a fork means.

The protocol, though, is in the source we already build. `--sync-url` points
the browser at a different server, and `--gaia-config` replaces every identity
endpoint and API key with our own. So the answer is not to get keys from
Google. It is to run both halves ourselves.

This package is the sync half.

## What works today

- The two exchanges that carry everything: **GetUpdates** and **Commit**.
- Per-account storage in SQLite, with monotonic versions, progress markers,
  client-tag deduplication, tombstones, and store birthdays.
- Every one of the 75 datatypes the protocol carries, because the server stores
  entities by datatype and opaque specifics rather than understanding any of
  them. Bookmarks are what has been exercised end to end.

## Where the data lives

`webdeck-sync serve` keeps one SQLite file per service at the path `--data`
names, `./webdeck-sync.db` by default, with SQLite's `-wal` and `-shm`
companions beside it. All three are ignored by `sync/.gitignore`; deleting
them resets the service (every browser then re-syncs from an empty store,
which Chromium handles as a new store birthday). `--data :memory:` keeps
nothing between runs, which the tests use.

## What does not work yet

- **The sign-in flow.** The identity endpoints answer correctly — token
  exchange, user info, token info, revoke, ListAccounts — and `config` writes
  the `--gaia-config` file that points a browser at them. What is missing is the
  interactive part: Chromium's sign-in serves HTML pages that are not built
  here, so a person cannot yet walk through signing in.
- **Authorisation.** Sync trusts the bearer token as the account id, which is
  safe for one person on loopback and nothing else. That is why it refuses to
  bind anywhere else.
- **Encryption.** Chrome encrypts most datatypes with a key the server never
  sees (Nigori). The server does not need to understand it, but the client
  needs a Nigori node to exist, and this does not serve one yet.
- **No browser has talked to it.** Everything here is verified against the real
  protocol definitions and real protobuf bytes, but the round trip with an
  actual browser has not been done.

## Run it

```bash
cd sync && npm install
./src/cli.mjs account --add you@example.com     # prints a refresh token
./src/cli.mjs serve                             # default port 8384
```

Run it through the shebang (`./src/cli.mjs`) or `npm run sync -- <command>`.
Both carry `--no-warnings=ExperimentalWarning`, which keeps node:sqlite from
announcing itself on every invocation. Plain `node src/cli.mjs` works too and
prints that notice.

If the port is taken, the command says so and how to find what has it. `--port 0`
takes any free port.

Then point a build at it:

```bash
"/Applications/Arcwel WebDeck.app/Contents/MacOS/Arcwel WebDeck" --sync-url=http://127.0.0.1:8384
```

`--sync-url` is enough to redirect sync. Sign-in still goes to Google and still
fails, which is why the identity service comes next.

## Commands

| Command | What it does |
| :-- | :-- |
| `serve` | run the service |
| `status` | what each account holds, by datatype |
| `reset` | throw one account's data away and mint a new birthday |
| `account` | add or list accounts, and print an account's refresh token |
| `config` | write the gaia-config.json that points a browser here |
| `datatypes` | every datatype this protocol version carries |

Every command takes `--json` and returns a meaningful exit code. `reset` takes
`--dry-run`.

## The protocol

`protocol/` holds Chromium's own `.proto` files, copied from the checkout named
in `chromium/fork.json`. They are not edited here. The server parses them at
startup, so the wire format has one definition rather than a transcription that
drifts.

```bash
node scripts/vendor-protos.mjs --check    # has upstream moved?
node scripts/vendor-protos.mjs            # take the new ones
```

Run the check after any upstream bump. A protocol change should show up as a
diff in this directory, not as sync quietly failing.

## Tests

```bash
npm test
```

Real protobuf bytes over real HTTP, against the vendored definitions. Nothing
mocks the protocol, because the protocol is the part that has to be right.
