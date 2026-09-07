# Tabs on your other devices, and sending things between them

A plan. Nothing in it is built yet; the pieces it builds on are.

## What the question was

WebDeck has no "sync tabs" or "send to phone". Chrome gets both from a Google
account, which a Chromium fork cannot sign in to. The question was whether an
open-source project such as [DashBeam](https://github.com/tonyantony300/dashbeam)
fills the gap, and if so how it would fit.

## What DashBeam is, and is not

DashBeam is a peer-to-peer **file transfer** tool: a Tauri desktop app, an
Android app and a CLI, all on [Iroh](https://iroh.computer), which gives it
device identity (an Ed25519 key per device), direct QUIC connections with
relays for NAT traversal, content-addressed blobs verified by BLAKE3, and
mDNS discovery on the local network. Devices pair once with a code and keep a
control connection open, so a send arrives as an invitation rather than a
ticket to paste. Its relay and discovery servers can be self-hosted.

It does not sync tabs, history or clipboard, and it has no public API. It is
licensed **AGPL-3.0**. WebDeck is MIT. Linking DashBeam's code into WebDeck
would put WebDeck under the AGPL; running it as a separate process, or using
Iroh directly (Iroh itself is MIT/Apache-2.0), does not. So the plan takes
the _design_ from DashBeam — pairing, presence, invitations, relays that see
only ciphertext — and the _transport_ from Iroh, and does not embed DashBeam.

## Two features, two backends

They look alike from the toolbar and are different underneath.

| Feature                          | What moves                                             | Needs the other device online? | Backend                                                                                                                               |
| :------------------------------- | :----------------------------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| **Tabs from your other devices** | The open tabs of every signed-in WebDeck, continuously | No — it is a store             | `webdeck-sync`, which already exists (`sync/`) and speaks Chromium's own sync protocol. Chromium's `session` datatype _is_ open tabs. |
| **Send to a device**             | One tab, link, selection or file, now                  | Yes — it is a delivery         | A new `devices` domain in the core, on Iroh, after DashBeam's pairing model                                                           |

The first is mostly turning on what is there. The second is new.

## Feature 1: tabs from your other devices

**Backend.** Chromium already keeps a `SESSIONS` datatype: every window and
tab, with URL, title and navigation history, per device. When a browser is
pointed at `webdeck-sync` with `--sync-url` and the `--gaia-config` it writes
(`webdeck-sync config`), Chromium commits sessions like any other type and
downloads every other device's. The service stores them as opaque entities
today; it needs to learn to _read_ one type so it can answer "what is open
where" without a full protocol client, which is a small decoder over the
vendored `session_specifics.proto`.

- `webdeck-sync`: add `sessions` to the CLI (`webdeck-sync sessions --json`)
  and an HTTP read endpoint (`GET /devices/tabs`) for the shell, behind the
  same bearer token the browser uses.
- Core: a `devices` domain that polls that endpoint on a 30-second interval
  when the window is focused and pushes `event:devices-tabs` to the shell.
  Nothing is stored in the core; the service is the store.
- Browser: nothing. Chromium's own sync engine does the work once
  `session.restore_on_startup` and the sync types are on, which the settings
  bridge already exposes.

**UI.** Three places, all read-only views of the same list.

- **Start page** — a row under the site tiles, "On your other devices", one
  chip per device with its last three tabs, each chip a click to open. Hidden
  when there is one device.
- **Tab search** (the tab-strip search) — a second section, "Other devices",
  searched with the same query, opening in a new tab.
- **History** — devices' tabs listed under their device name, since that is
  where Chrome puts them and where people look.

**Workflow.** Sign in to the same sync service on two machines (Settings →
WebDeck → Sync, the account the CLI created). Open tabs on the laptop; within a
minute they appear on the desktop's start page under the laptop's name. Close
the laptop; the list stays, marked with when it was last seen. There is no
"send": the tabs are simply there.

## Feature 2: send to a device

**Backend: a `devices` domain in the core, on Iroh.**

- _Identity._ One Iroh endpoint per WebDeck install, keyed in the user data
  directory, named by the machine. The key never leaves the machine.
- _Pairing._ Settings → WebDeck → Devices shows a six-digit code and a QR;
  entering it on the other device exchanges endpoint IDs and a shared secret.
  The list of paired devices lives in the core (`devices.json`), and every
  later connection authenticates against it. This is DashBeam's model.
- _Presence._ A paired device keeps a lightweight control connection open
  while WebDeck runs, so the send menu can show who is reachable now.
  Same-network devices are also found by mDNS, unpaired, for a one-time send
  with a confirmation code on the receiving side.
- _Delivery._ A send is a small signed message — a URL with title, a text
  selection, or a blob ticket for a file. Files travel as Iroh blobs, resumable,
  never through a server; relays carry ciphertext only. A self-hosted relay is
  an address in Settings, as in DashBeam's `infra`.
- _Receiving._ The core receives, verifies the sender is paired, and hands the
  shell an `event:devices-received` with what arrived. Nothing is opened
  automatically: a received link is an offer, not a navigation.
- _Phone._ The plan needs a receiver on the phone. Short term that is
  DashBeam's own Android app for files (it speaks the same Iroh protocol) and
  a small WebDeck receiver app for links; long term a WebDeck mobile receiver
  that also feeds Feature 1.

**UI.**

- **Send menu.** A "Send to…" item in the tab's context menu, the page's share
  menu and the address-bar menu, listing paired devices with a presence dot,
  then nearby devices. Choosing one sends the tab; a selection on the page
  sends the selection; a file dropped on a device name in the menu sends the
  file. ⌘⇧S opens it.
- **Received tray.** A bell in the toolbar's right cluster with a count.
  Opening it lists what arrived — link, text, file — with who sent it, when,
  and one action each: Open in a tab, Copy, Save. A file shows progress while
  it lands and where it went.
- **Devices settings.** The pairing code and QR, the paired list with rename
  and forget, nearby devices, the relay address, and a switch for "receive
  from nearby devices without pairing" (off by default).
- **Start page.** The same row as Feature 1 gains a "Sent to this device"
  group when something is waiting.

**Workflows.**

1. _Pair._ Settings → Devices → Pair a device. Read the code on the phone or
   type it; both sides show the same name and confirm. Done once.
2. _Send a page to the phone._ On any page, ⌘⇧S → the phone. The phone
   shows a notification; tapping it opens the link. Nothing else is sent.
3. _Send a file from a page._ Drag a download, or a file from the Files
   block, onto a device name in the send menu. Progress in the tray on both
   ends; the receiver picks the folder once.
4. _Receive._ A bell count appears; open the tray; Open in a tab. A link
   never opens itself.
5. _Nearby without pairing._ On a laptop next to you, Send to → Nearby →
   the laptop; the laptop shows a four-digit code; you read it back. Once.

## Security, stated up front

- A device is a key, not an account. Losing the machine means forgetting the
  device on every other one, which Settings makes one click.
- Every message is signed by the sending device and encrypted to the
  receiving one; relays and the sync service see nothing readable.
- A received link is shown, never opened. A received file is stored, never
  run. The agent is not granted received files unless the user opens them.
- Feature 1's tabs are whatever `webdeck-sync` holds; it is the user's own
  service or one they chose, and encryption of sync data (Nigori) remains on
  the sync roadmap.

## Order of work

1. `webdeck-sync sessions` and the `/devices/tabs` endpoint. Small; unlocks
   Feature 1 end to end with two laptops.
2. The start-page row and tab-search section for other devices' tabs.
3. The `devices` core domain on Iroh: identity, pairing, presence, link send.
4. Send menu, received tray, devices settings.
5. File send as Iroh blobs, with DashBeam's Android app as the first phone
   receiver for files.
6. A WebDeck phone receiver for links, then tabs.

Each step ships on its own and is verified on the real window, as the rest of
the browser is.
