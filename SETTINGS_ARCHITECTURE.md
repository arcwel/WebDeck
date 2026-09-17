# Settings architecture

**Status: decided. Do not re-litigate without Anthony's explicit say-so.**

WebDeck has two settings surfaces because it has two products in one window: a
browser that is Chromium, and an IDE that is WebDeck. Each surface belongs to
whichever of the two actually owns the setting, and the menu you reach it from
says which one you are getting.

## The rule

| You want | You open | It is |
| :-- | :-- | :-- |
| Browser settings | The browser menu's **Settings**, or the profile menu's **All settings…** | `chrome://settings` — Chromium's real page, in a tab |
| WebDeck settings | **File → Settings…**, or ⌘, | WebDeck's own sheet |

Two consequences follow, and both are the point rather than an oversight:

- **WebDeck does not redraw Chromium's settings.** No mirror, no allowlisted
  pref bridge standing in for the page, no "Browser" tab inside WebDeck's sheet.
- **Chromium's page does not carry WebDeck's settings.** Provider keys, the
  editor, keybindings, colours and sync are not Chromium's to show.

## Why

A redrawing of `chrome://settings` can only ever be a subset of it. Chromium
adds rows every release, and each one silently goes missing from the copy. The
copy also has to reach into Chromium's prefs to write anything, which means an
allowlist that grows forever and a second writer for settings that already have
one. The real page has none of these problems and costs nothing to maintain.

## What still lives in WebDeck's sheet, and why it is not an exception

Four browsing controls sit under **File → Settings… → Application → Browsing**.
They are there because `chrome://settings` has no way to show them — they are
not Chromium's:

- **Toolbar buttons** — WebDeck draws its own toolbar; Chromium knows nothing
  about it.
- **Block ads and trackers** — this fork's blocker, not upstream's.
- **Default browser** — has to name this app.
- **Clear browsing data** — drives Chromium's remover, but it is the one
  destructive action people look for under the app's own settings.

Adding a fifth row here needs the same test: **would `chrome://settings` be able
to show this?** If yes, it does not belong in WebDeck's sheet.

## The one pref WebDeck reads from Chromium

`browser.show_home_button`. WebDeck draws the home button itself, so it has to
read the pref `chrome://settings` writes or the switch would move and change
nothing. That page cannot announce a change to this one, so the toolbar re-reads
on window focus — see `app/src/renderer/src/toolbar-visibility.ts`.

This is the exception that proves the rule, and it stays a read. WebDeck does
not write Chromium's prefs.

## Does a Chromium setting actually take effect?

Mostly yes, and where it does not, the reason is always the same: **WebDeck
draws that part of the browser itself, so Chromium has nothing to apply the
setting to.** Those few have a WebDeck setting that is the real owner.

| `chrome://settings` section | Takes effect | Why |
| :-- | :-- | :-- |
| Privacy and security | Yes | Network stack and content settings are Chromium's. |
| Autofill and passwords | Yes | Chromium's encrypted profile store. |
| Performance | Yes | Chromium's memory and preload behaviour. |
| Downloads | Yes | Chromium performs downloads on this build. |
| Languages, Accessibility, System | Yes | Chromium's. |
| Default browser | Yes | The OS registration is Chromium's. |
| Appearance → page zoom, fonts | Yes | Applied to page content. |
| Appearance → **show home button** | Yes, on focus | WebDeck draws the button but reads the pref. It re-reads when the window regains focus, because `chrome://settings` cannot announce the change. |
| Appearance → browser theme | **No** | WebDeck draws its own chrome. Use Settings → Application → Appearance. |
| Appearance → bookmarks bar | **No** | This build has no Chromium bookmarks bar. The Favourites bar is a WebDeck toolbar button. |
| **Search engine** | **No** | WebDeck draws its own address bar and resolves searches itself (`omnibox-rank.ts`). Use Settings → Application → Search. |
| **On startup** | **No** | WebDeck restores its own tabs (`restoreTabs`). Use Settings → Application → General. |

The four "No" rows are not defects to fix by wiring the Chromium pref through.
Doing that would give each setting two writers, which is the failure this
architecture exists to avoid. One owner per setting.

## History — why this file exists

This arrangement was decided, then quietly undone by later work, then decided
again. The reversal is the reason for writing it down.

| When | What happened |
| :-- | :-- |
| before 2026-09-03 | The browser menu opened `chrome://settings` in a tab. |
| 2026-09-03 `cfa75e1` | "mirror Chrome's settings surface over an allowlisted preference bridge" — built a WebDeck-drawn copy of `chrome://settings`. |
| 2026-09-04 `4120036` | "one settings sheet" — removed the entry that opened the real page, on the reasoning that two entries made "settings" ambiguous. The ambiguity was real; the fix pointed the wrong way. |
| 2026-09-16 | Reverted to the rule at the top of this file. The mirror and its settings map were deleted, about 1,100 lines. Settings moved from the app menu to **File → Settings…**. |

Nothing was lost in a rebuild. The surface changed because code changed, and
nothing recorded the decision it was changing, so the next person to look at it
saw only the ambiguity and not the reason. That is what this file fixes.

## Where this is enforced in code

- `app/src/renderer/src/components/Toolbar.tsx` — the browser menu's Settings
  item and the profile menu's "All settings…" both open `chrome://settings`.
- `app/src/renderer/src/components/SettingsBlock.tsx` — WebDeck's sheet. One
  side only; no Browser scope.
- `app/src/renderer/src/components/BrowsingControls.tsx` — the four controls
  above, and the note on what may join them.
- `chromium/patches/chrome/browser/ui/cocoa/main_menu_builder.mm` (in
  `upstream-edits.diff`) — Settings sits in the File menu, not the app menu.
- `chromium/patches/chrome/browser/ui/webui/webdeck/webdeck_shell.cc` —
  `IDC_OPTIONS` is intercepted and forwarded to the shell as `preferences`, so
  ⌘, opens WebDeck's sheet rather than a `chrome://settings` tab.
