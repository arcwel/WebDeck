import { useCallback, useEffect, useState } from 'react'
import { docNavTarget, searchUrlFor } from '@shared/ipc'
import { openFileFromPicker } from '@/open-local-file'
import type { BrowserAccountInfo, ExtensionActionInfo } from '@shared/ipc'
import { BLOCK_LABELS, useShellStore, type BlockType, type DeckPreset } from '@/store'
import { asDirectUrl, type Suggestion } from '@/omnibox-rank'
import {
  OMNIBOX_LISTBOX_ID,
  OmniboxDropdown,
  currentSearchEngine,
  omniboxOptionId,
  useOmniboxSuggestions
} from '@/components/Omnibox'
import { DeckIcon, PopOutIcon, ReaderIcon } from '@/components/icons'
import { useExtensionViewContainers } from '@/editor-views'
import { AiAnswer } from '@/components/AiAnswer'
import { BookmarkControls, FindBar, ZoomControls } from '@/components/BrowserControls'
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  CloseIcon,
  HomeIcon as ChromeHomeIcon,
  IncognitoIcon,
  MoreVertIcon,
  PersonIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
  ExtensionIcon,
  HistoryIcon,
  SplitscreenIcon
} from '@/components/browser-icons'
import { GridIcon, ShieldIcon } from '@/components/UtilitiesBar'
import { DownloadsIndicator } from '@/components/DownloadsIndicator'
import { usePopover } from '@/popover'
// Split view + Picture-in-Picture drive the window's real tabs over the Mojo
// Shell, so they route through the shell bridge directly (the same blessed
// cross-import BrowserSettings uses for browserPrefs), not window.agweb.browser.
import { pictureInPicture } from '../../../webui/shell'

const PRESETS: { id: DeckPreset; label: string; hint: string }[] = [
  { id: 'browsing', label: 'Browsing', hint: 'Deck hidden — just the web' },
  { id: 'building', label: 'Building', hint: 'Editor & files beside the page' },
  {
    id: 'debugging',
    label: 'Debugging',
    hint: 'Files left, debugger beside the editor, logs forward'
  }
]

/** Turn address-bar input into a navigable URL (or a search query). The
 *  URL-vs-search decision lives in asDirectUrl, shared with the omnibox. */
export function toNavigableUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  return asDirectUrl(trimmed) ?? searchUrlFor(currentSearchEngine(), trimmed)
}

/** Ensure the tab's WebContentsView exists, then load the URL into it.
 *
 *  A document in the open workspace is answered by Document Studio instead:
 *  checked BEFORE the native view is created, so a .md never flashes as raw
 *  text on its way to being styled. */
export async function navigateTab(tabId: string, url: string): Promise<void> {
  const { tabs, markTabHasContent, workspace, openDoc } = useShellStore.getState()
  const docPath = docNavTarget(url, workspace?.path ?? null)
  if (docPath) {
    openDoc(docPath)
    return
  }
  const tab = tabs.find((t) => t.id === tabId)
  if (tab && !tab.hasContent) {
    await window.agweb.browser.create(tabId)
    markTabHasContent(tabId)
  }
  await window.agweb.browser.navigate(tabId, url)
}

export function Toolbar(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const homeUrl = useShellStore((s) => s.homeUrl)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const state = useShellStore((s) => s.browserStates[s.activeTabId])
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const deckMode = useShellStore((s) => s.deckMode)
  const toggleDeck = useShellStore((s) => s.toggleDeck)
  const detachDeck = useShellStore((s) => s.detachDeck)
  const applyPreset = useShellStore((s) => s.applyPreset)
  const addBlock = useShellStore((s) => s.addBlock)
  const [urlInput, setUrlInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [blocksOpen, setBlocksOpen] = useState(false)
  // View containers installed extensions contribute — each is an Add-block entry (12.8).
  const extensionViews = useExtensionViewContainers()
  const splitTabId = useShellStore((s) => s.splitTabId)
  const toggleSplit = useShellStore((s) => s.toggleSplit)
  const proxyEnabled = useShellStore((s) => s.embedProxyEnabled)
  const setEmbedProxyEnabled = useShellStore((s) => s.setEmbedProxyEnabled)
  const utilitiesOpen = useShellStore((s) => s.utilitiesOpen)
  const setUtilitiesOpen = useShellStore((s) => s.setUtilitiesOpen)
  const readerOpen = useShellStore((s) => s.readerOpen)
  const setReaderOpen = useShellStore((s) => s.setReaderOpen)
  // Reader Mode reads the staged page's text over the Mojo Shell, so it only
  // makes sense once the active tab actually has a loaded page.
  const tabHasContent = (activeTab?.kind === 'web' && activeTab.hasContent) ?? false

  const blocksRef = usePopover(
    blocksOpen,
    useCallback(() => setBlocksOpen(false), [])
  )

  useEffect(() => {
    let cancelled = false
    void window.agweb.embedProxy.status().then((status) => {
      if (!cancelled) setEmbedProxyEnabled(status.enabled)
    })
    return () => {
      cancelled = true
    }
  }, [setEmbedProxyEnabled])

  const [selected, setSelected] = useState(-1)
  // The open "Ask AI" answer, or null. Held here (not in the store) so the
  // answer state stays local to the omnibox surface.
  const [askOpen, setAskOpen] = useState<string | null>(null)
  const isDocTab = activeTab?.kind === 'doc'
  const suggestions = useOmniboxSuggestions(urlInput, editing && !isDocTab)
  // The answer panel and the suggestion dropdown share one surface — only one is
  // ever shown, the panel winning while an ask is open.
  const omniboxOpen = editing && !isDocTab && askOpen === null && suggestions.length > 0
  // The dropdown AND the answer panel paint over the stage, so the surface must
  // register as an overlay (usePopover) or the native WebContentsView would
  // swallow it. This also closes it on Escape and on any outside pointer press.
  const overlayOpen = omniboxOpen || askOpen !== null
  const closeOverlay = useCallback(() => {
    setAskOpen(null)
    setEditing(false)
  }, [])
  const omniboxRef = usePopover(overlayOpen, closeOverlay)

  const liveUrl = state?.url && state.url !== 'about:blank' ? state.url : ''
  const displayedUrl = editing ? urlInput : liveUrl

  const navigate = (): void => {
    const url = toNavigableUrl(urlInput)
    if (url) void navigateTab(activeTabId, url)
    setEditing(false)
  }

  // Route selected suggestions through the same navigate path the bar already
  // uses on submit — never bypass it. The "Ask AI" row is the exception: it
  // opens the inline answer panel instead of navigating anywhere.
  const pickSuggestion = (suggestion: Suggestion): void => {
    if (suggestion.kind === 'ask') {
      setAskOpen(suggestion.title)
      setSelected(-1)
      return
    }
    void navigateTab(activeTabId, suggestion.url)
    setEditing(false)
    setSelected(-1)
  }

  // Open a source link from the answer panel through the toolbar's own navigate
  // path, then dismiss the panel.
  const openFromAnswer = (url: string): void => {
    void navigateTab(activeTabId, url)
    closeOverlay()
    setSelected(-1)
  }

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    // While the answer panel is open the input is inert: Esc dismisses it, and
    // Enter is swallowed so a stray keystroke can't navigate out from under it.
    if (askOpen !== null) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeOverlay()
      } else if (e.key === 'Enter') {
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown' && omniboxOpen) {
      e.preventDefault()
      setSelected((i) => (i + 1) % suggestions.length)
      return
    }
    if (e.key === 'ArrowUp' && omniboxOpen) {
      e.preventDefault()
      setSelected((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
      return
    }
    if (e.key === 'Enter') {
      if (omniboxOpen && selected >= 0 && selected < suggestions.length) {
        e.preventDefault()
        pickSuggestion(suggestions[selected])
        return
      }
      navigate()
      return
    }
    if (e.key === 'Escape' && omniboxOpen) {
      e.preventDefault()
      setSelected(-1)
      setEditing(false)
    }
  }

  // Split view + PiP drive the window's real tabs over the Mojo Shell, which
  // only exists on the Arcwel WebDeck (Chromium) build. Off that host the calls
  // reject, so hide the controls rather than surface a button that silently
  // does nothing (the anti-pattern this codebase calls out for host-owned ops).
  const forkHost = window.agweb.host?.kind === 'chromium'
  // Split view is store-driven: toggleSplit picks a companion tab (or opens one)
  // and sets splitTabId; Stage streams the two stage rects and the browser binds
  // each tab. This button is one entry point (the utilities bar + command are
  // others) — all share the store so the on-state stays consistent.

  const togglePip = (): void => {
    void pictureInPicture.toggle(activeTabId)
  }

  const navButton = 'wd-icon'

  return (
    <div className="drag-region flex items-center gap-2 px-2 py-1.5">
      {/* Navigation */}
      <div className="flex items-center gap-px">
        <button
          className={navButton}
          disabled={!state?.canGoBack}
          onClick={() => void window.agweb.browser.back(activeTabId)}
          aria-label="Back"
        >
          <ArrowBackIcon />
        </button>
        <button
          className={navButton}
          disabled={!state?.canGoForward}
          onClick={() => void window.agweb.browser.forward(activeTabId)}
          aria-label="Forward"
        >
          <ArrowForwardIcon />
        </button>
        <button
          className={navButton}
          disabled={!state}
          onClick={() =>
            state?.isLoading
              ? void window.agweb.browser.stop(activeTabId)
              : void window.agweb.browser.reload(activeTabId)
          }
          aria-label={state?.isLoading ? 'Stop' : 'Reload'}
        >
          {state?.isLoading ? <StopIcon /> : <RefreshIcon />}
        </button>
        <button
          className={navButton}
          onClick={() => void navigateTab(activeTabId, homeUrl)}
          aria-label="Home"
          title={`Home — ${homeUrl}`}
          data-testid="nav-home"
        >
          <ChromeHomeIcon />
        </button>
        <button
          className={`${navButton} ${readerOpen ? 'wd-icon-on' : ''}`}
          disabled={!tabHasContent}
          onClick={() => setReaderOpen(!readerOpen)}
          aria-label="Reader mode"
          aria-pressed={readerOpen}
          title="Reader mode"
          data-testid="reader-toggle"
        >
          <ReaderIcon />
        </button>
      </div>

      {/* Address, centred: the icon clusters flank it on both sides. The
          bookmark star leads the bar on the far left; zoom sits on the right. */}
      <div ref={omniboxRef} className="relative flex min-w-0 flex-1 items-center">
        <div className="absolute left-1.5 flex items-center">
          <BookmarkControls
            tabId={activeTabId}
            url={state?.url ?? ''}
            title={state?.title ?? ''}
            align="left"
          />
        </div>
        <input
          value={isDocTab ? `studio · ${activeTab?.docPath}` : displayedUrl}
          disabled={isDocTab}
          placeholder="Enter URL or search…"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={omniboxOpen}
          aria-controls={OMNIBOX_LISTBOX_ID}
          aria-activedescendant={
            omniboxOpen && selected >= 0 ? omniboxOptionId(selected) : undefined
          }
          onChange={(e) => {
            setEditing(true)
            setUrlInput(e.target.value)
            // Typing rebuilds the ranked list, so any highlighted row is stale —
            // drop back to "nothing selected" (Enter then submits the raw input).
            setSelected(-1)
          }}
          onFocus={(e) => {
            setEditing(true)
            setUrlInput(liveUrl)
            setSelected(-1)
            e.target.select()
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={handleAddressKeyDown}
          style={{ borderRadius: 'var(--wd-r-pill)' }}
          className="m w-full border border-[var(--wd-glass-border)] bg-[var(--wd-field)] py-1.5 pr-14 pl-[4.6rem] text-[12px] text-[var(--wd-text)] outline-none placeholder:text-[var(--wd-dim)] focus:border-[var(--wd-accent-line)]"
        />
        <div className="absolute right-1.5 flex items-center">
          <ZoomControls tabId={activeTabId} />
        </div>
        {askOpen !== null ? (
          <AiAnswer
            query={askOpen}
            url={liveUrl || undefined}
            title={activeTab?.title || state?.title || undefined}
            onOpen={openFromAnswer}
            onClose={closeOverlay}
          />
        ) : (
          omniboxOpen && (
            <OmniboxDropdown
              suggestions={suggestions}
              selectedIndex={selected}
              query={urlInput}
              onHover={setSelected}
              onPick={pickSuggestion}
            />
          )
        )}
      </div>

      {proxyEnabled && (
        <button
          onClick={() =>
            void window.agweb.embedProxy
              .setEnabled(false)
              .then((status) => setEmbedProxyEnabled(status.enabled))
          }
          className="wd-icon text-amber-400"
          title="Embed proxy is on for localhost — click to turn it off"
          data-testid="proxy-indicator"
        >
          <ShieldIcon />
        </button>
      )}

      {/* Everything from here sits hard right. */}
      <div className="ml-auto flex flex-none items-center gap-px">
        <button
          onClick={() => setUtilitiesOpen(!utilitiesOpen)}
          className={`wd-icon ${utilitiesOpen ? 'wd-icon-on' : ''}`}
          title="Favourites bar"
          aria-label="Favourites bar"
          data-testid="utilities-toggle"
        >
          <GridIcon />
        </button>
        {forkHost && (
          <>
            <button
              onClick={toggleSplit}
              className={`wd-icon ${splitTabId ? 'wd-icon-on' : ''}`}
              title={splitTabId ? 'Exit split view' : 'Split view — stage two tabs side by side'}
              aria-label="Split view"
              aria-pressed={splitTabId !== null}
              data-testid="split-toggle"
            >
              <SplitscreenIcon />
            </button>
            <button
              onClick={togglePip}
              className="wd-icon"
              title="Picture-in-Picture — pop the video out"
              aria-label="Picture-in-Picture"
              data-testid="pip-toggle"
            >
              <PopOutIcon />
            </button>
          </>
        )}
        <PinnedExtensions tabId={activeTabId} url={state?.url ?? ''} />
        <ExtensionsButton />
        <DownloadsIndicator />
        <FindBar tabId={activeTabId} />
        <BrowserMenu />
      </div>

      {/* Profiles sit directly left of the Deck button. */}
      <ProfileButton />

      {deckMode === 'detached' ? (
        <button
          onClick={() => void window.agweb.windows.focusDeck()}
          className="wd-icon"
          aria-label="Focus detached deck window"
          title="The deck is detached — click to focus its window"
          data-testid="deck-detached"
        >
          <PopOutIcon />
        </button>
      ) : (
        <button
          onClick={toggleDeck}
          className="wd-icon"
          style={{
            background: deckRevealed ? 'var(--wd-accent)' : 'var(--wd-accent-soft)',
            color: deckRevealed ? 'var(--wd-accent-ink)' : 'var(--wd-accent)'
          }}
          aria-label="Toggle Dev Deck"
          title="Dev Deck (⌘D)"
          data-testid="deck-toggle"
        >
          <DeckIcon />
        </button>
      )}

      {deckRevealed && deckMode === 'attached' && (
        <>
          <div className="relative flex-none" ref={blocksRef}>
            <button
              onClick={() => setBlocksOpen((o) => !o)}
              className="wd-icon"
              aria-label="Deck options"
              title="Deck options"
              data-testid="deck-menu"
            >
              <MoreVertIcon />
            </button>
            {blocksOpen && (
              <div className="glass absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-[14px] py-1">
                <div className="wd-cap px-3 py-1.5">Add block</div>
                {(Object.keys(BLOCK_LABELS) as BlockType[])
                  // extview blocks are added per container, below — never bare.
                  .filter((type) => type !== 'extview')
                  .map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        addBlock(type)
                        setBlocksOpen(false)
                      }}
                      className="block w-full px-3.5 py-1.5 text-left text-xs font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
                    >
                      {BLOCK_LABELS[type]}
                    </button>
                  ))}
                {extensionViews.length > 0 && (
                  <>
                    <div className="wd-cap mt-1 border-t border-[var(--wd-hairline)] px-3 py-1.5">
                      Extension views
                    </div>
                    {extensionViews.map((view) => (
                      <button
                        key={view.id}
                        onClick={() => {
                          addBlock(
                            'extview',
                            { containerId: view.id, extensionId: view.extensionId },
                            view.title
                          )
                          setBlocksOpen(false)
                        }}
                        className="block w-full px-3.5 py-1.5 text-left text-xs font-medium text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]"
                      >
                        {view.title}
                      </button>
                    ))}
                  </>
                )}
                <div className="wd-cap mt-1 border-t border-[var(--wd-hairline)] px-3 py-1.5">
                  Layout
                </div>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      applyPreset(preset.id)
                      setBlocksOpen(false)
                    }}
                    className="flex w-full flex-col gap-0.5 px-3.5 py-1.5 text-left hover:bg-[var(--wd-hover)]"
                  >
                    <span className="text-xs font-semibold text-[var(--wd-text)]">
                      {preset.label}
                    </span>
                    <span className="text-[11px] text-[var(--wd-dim)]">{preset.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={detachDeck}
            className="wd-icon"
            aria-label="Detach deck"
            title="Detach the deck into its own window"
          >
            <PopOutIcon />
          </button>
        </>
      )}
    </div>
  )
}

/** Extensions, with the notification dot the design shows. */
/**
 * Chrome's profile avatar. Switching the active profile changes which
 * persistent session new tabs open in, so each profile keeps its own signed-in
 * accounts (Google included). New tabs pick up the switch; existing tabs keep
 * the profile they were opened in, exactly as separate Chrome windows do.
 */
function ProfileButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{
    profiles: Array<{ id: string; name: string; color: string }>
    activeId: string
  } | null>(null)
  const [google, setGoogle] = useState<Record<string, boolean>>({})
  const [account, setAccount] = useState<BrowserAccountInfo | null>(null)
  // The user's own picture wins over anything the browser knows: they chose it.
  const [chosenImage, setChosenImage] = useState('')
  const [adding, setAdding] = useState('')
  const activeUrl = useShellStore((s) => s.browserStates[s.activeTabId]?.url ?? '')
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const refresh = useCallback(() => {
    void window.agweb.profiles.list().then(setState)
    // The per-profile Google map only feeds the menu drawn when the host does
    // NOT own sign-in; where the browser does, the account comes from it.
    if (!window.agweb.host.ownsBrowserFeatures) {
      void window.agweb.profiles.googleStatus().then(setGoogle)
    }
  }, [])
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // The account is read on mount and after every navigation, not only when the
  // menu opens — the button shows the avatar, so waiting for a click meant it
  // never updated at all. Signing in navigates, so the picture appears as soon
  // as it exists; the image itself is fetched asynchronously by the browser,
  // which is the other reason a single read at startup is not enough.
  useEffect(() => {
    let cancelled = false
    void window.agweb.appSettings
      .read()
      .then((s) => {
        if (!cancelled) setChosenImage(s.profileImage ?? '')
      })
      .catch(() => {
        // No settings, no custom picture; the browser's avatar still shows.
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!window.agweb.host.ownsBrowserFeatures) return
    let cancelled = false
    void window.agweb.profiles
      .account()
      .then((info) => {
        if (!cancelled) setAccount(info)
      })
      .catch(() => {
        if (!cancelled) setAccount(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeUrl, open])

  // Sign a Google account into a specific profile: make it active, then open
  // Google's own sign-in page in a tab of that profile's session.
  const signInGoogle = async (profileId: string): Promise<void> => {
    await window.agweb.profiles.setActive(profileId).then(setState)
    useShellStore.getState().syncProfile(profileId)
    useShellStore.getState().newTab('https://accounts.google.com/')
    setOpen(false)
  }

  const active = state?.profiles.find((p) => p.id === state.activeId)

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon relative"
        title={active ? `Profile: ${active.name}` : 'Profiles'}
        aria-label="Profiles"
        data-testid="profile-button"
      >
        {chosenImage || account?.avatarDataUrl ? (
          <img
            src={chosenImage || account?.avatarDataUrl}
            alt=""
            width={18}
            height={18}
            className="h-[18px] w-[18px] rounded-full"
            data-testid="account-avatar"
          />
        ) : account?.signedIn ? (
          // Signed in, picture not downloaded yet: the initial of the account,
          // which is still more informative than a generic silhouette.
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--wd-accent)] text-[10px] font-bold text-[var(--wd-accent-ink)]">
            {(account.fullName || account.email).charAt(0).toUpperCase()}
          </span>
        ) : active ? (
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-[var(--wd-accent-ink)]"
            style={{ background: active.color }}
          >
            {active.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <PersonIcon size={15} />
        )}
      </button>
      {open && window.agweb.host.ownsBrowserFeatures && (
        // Chromium owns profiles and Google sign-in on the fork: hand the person
        // to the browser's own pages, opened as tabs in this window.
        <div className="glass absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[14px] p-1">
          {/* Who is signed in, said plainly at the top — the menu used to open
              with four links and never name the account it belonged to. */}
          <div className="flex items-center gap-2.5 px-3 pb-2 pt-2">
            {chosenImage || account?.avatarDataUrl ? (
              <img
                src={chosenImage || account?.avatarDataUrl}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 flex-none rounded-full object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--wd-field)] text-[13px] font-bold text-[var(--wd-dim)]">
                {(account?.fullName || account?.email || '?').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-[var(--wd-text)]">
                {account?.fullName || account?.profileName || 'Not signed in'}
              </span>
              <span className="block truncate text-[10.5px] text-[var(--wd-dim)]">
                {account?.signedIn
                  ? account.email
                  : account?.signinSupported === false
                    ? 'Local profile — the browser is not signed in to Google'
                    : 'Sign in to sync and use Google services'}
              </span>
            </span>
          </div>

          {!account?.signedIn &&
            (account?.signinSupported === false ? (
              // Saying nothing here, or offering a button that cannot work, is
              // what made "signed in on google.com but not in the browser"
              // look like a bug. This build has no Google OAuth client, so
              // browser sign-in and Sync cannot start at all.
              <p className="mb-1 rounded-lg bg-[var(--wd-well)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--wd-dim)]">
                Signing in to Google on a website works normally and keeps you signed in there.
                Signing in to the <em>browser</em>, and Chrome Sync with it, needs Google&rsquo;s
                own API keys, which are issued only to official Chrome builds — so this build shows
                your local profile picture instead.
              </p>
            ) : (
              <button
                onClick={() => {
                  useShellStore.getState().newTab('https://accounts.google.com/')
                  setOpen(false)
                }}
                className="mb-1 block w-full rounded-lg bg-[var(--wd-accent)] px-3 py-1.5 text-center text-[12px] font-semibold text-[var(--wd-accent-ink)]"
              >
                Sign in to Google
              </button>
            ))}

          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          {/* Saved passwords, autofill, payment methods and addresses are
              Chromium's own surfaces and cannot be rebuilt from outside them —
              they read the profile's encrypted store. So the menu links
              straight at each one rather than dropping people at the root of
              settings to hunt. */}
          {(
            [
              ['Passwords', 'chrome://password-manager/passwords'],
              ['Autofill and addresses', 'chrome://settings/addresses'],
              ['Payment methods', 'chrome://settings/payments'],
              ['Sync and Google services', 'chrome://settings/syncSetup'],
              ['Profiles & account settings', 'chrome://settings/people'],
              ['Extensions', 'chrome://extensions/']
            ] as const
          ).map(([label, url]) => (
            <button
              key={url}
              onClick={() => {
                useShellStore.getState().newTab(url)
                setOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-1.5 text-left text-[12px] text-[var(--wd-text)] hover:bg-[var(--wd-hover)]"
            >
              {label}
            </button>
          ))}
          {/* Generic settings has one home: the sheet, whose Browser side is
              Chromium's settings. A second entry that opened a chrome:// tab
              is what made "settings" ambiguous. */}
          <button
            onClick={() => {
              useShellStore.getState().setSettingsOpen(true)
              setOpen(false)
            }}
            className="block w-full rounded-lg px-3 py-1.5 text-left text-[12px] text-[var(--wd-text)] hover:bg-[var(--wd-hover)]"
          >
            All settings…
          </button>
        </div>
      )}
      {open && !window.agweb.host.ownsBrowserFeatures && state && (
        <div className="glass absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[14px] p-1">
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
            Google profiles
          </p>
          {state.profiles.map((profile) => {
            const signedIn = google[profile.id] ?? false
            const incognito = profile.id === 'incognito'
            return (
              <div
                key={profile.id}
                className={`group rounded-lg px-2 py-1.5 ${
                  profile.id === state.activeId
                    ? 'bg-[var(--wd-accent-soft)]'
                    : 'hover:bg-[var(--wd-hover)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      void window.agweb.profiles.setActive(profile.id).then(setState)
                      useShellStore.getState().syncProfile(profile.id)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold text-[var(--wd-accent-ink)]"
                      style={{ background: profile.color }}
                    >
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-[var(--wd-text)]">
                        {profile.name}
                      </span>
                      <span
                        className={`block text-[10px] ${
                          signedIn ? 'text-emerald-500' : 'text-[var(--wd-dim)]'
                        }`}
                      >
                        {incognito
                          ? 'Private — nothing is saved'
                          : signedIn
                            ? '● Signed in to Google'
                            : 'Not signed in'}
                      </span>
                    </span>
                    {profile.id === state.activeId && (
                      <span className="ml-auto text-[9.5px] font-semibold text-[var(--wd-accent)]">
                        ACTIVE
                      </span>
                    )}
                  </button>
                  {profile.id !== 'default' && !incognito && (
                    <button
                      onClick={() => {
                        void window.agweb
                          .confirm(
                            `Remove the “${profile.name}” profile? Its cookies, logins, and site data are permanently deleted.`
                          )
                          .then((ok) => {
                            if (ok) void window.agweb.profiles.remove(profile.id).then(setState)
                          })
                      }}
                      className="hidden flex-none text-[var(--wd-dim)] hover:text-rose-500 group-hover:block"
                      title="Remove profile and its data"
                      aria-label="Remove profile"
                    >
                      <CloseIcon size={13} />
                    </button>
                  )}
                </div>
                {!incognito && (
                  <button
                    onClick={() => void signInGoogle(profile.id)}
                    className="mt-1 ml-8 text-[10.5px] font-medium text-[var(--wd-accent)] hover:underline"
                  >
                    {signedIn ? 'Manage Google account →' : 'Sign in to Google →'}
                  </button>
                )}
              </div>
            )
          })}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (adding.trim() === '') return
              void window.agweb.profiles.create(adding.trim()).then((next) => {
                setState(next)
                setAdding('')
              })
            }}
            className="mt-1 flex items-center gap-1 border-t border-[var(--wd-glass-border)] px-2 pt-1.5"
          >
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="New profile…"
              className="min-w-0 flex-1 rounded-md bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-[var(--wd-accent)]"
            />
            <button
              type="submit"
              className="rounded-md bg-[var(--wd-accent)] px-2 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)]"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/'

/**
 * The extensions the user pinned in chrome://extensions, drawn in the toolbar.
 *
 * Chromium paints extension buttons in its own toolbar, which this build does
 * not have — the toolbar is this page. So "Pin to toolbar" was a switch with
 * nowhere to show its result. The pinned list, each action's per-page title,
 * badge and enabled state all come from the browser; the icon is Chromium's
 * own chrome://extension-icon renderer, so nothing ships bitmaps over Mojo.
 *
 * `url` is not read — it is the re-fetch trigger. An extension changes its
 * badge and title per page, so the list is re-read whenever the tab navigates.
 */
function PinnedExtensions({ tabId, url }: { tabId: string; url: string }): React.JSX.Element {
  const [actions, setActions] = useState<ExtensionActionInfo[]>([])

  useEffect(() => {
    if (!window.agweb.host.ownsBrowserFeatures) return
    let cancelled = false
    void window.agweb.extensions
      .actions(tabId)
      .then((list) => {
        if (!cancelled) setActions(list)
      })
      .catch(() => {
        // An older browser build has no such call. An empty toolbar is the
        // right answer; a thrown promise would take the whole toolbar down.
        if (!cancelled) setActions([])
      })
    return () => {
      cancelled = true
    }
  }, [tabId, url])

  if (actions.length === 0) return <></>
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => void window.agweb.extensions.runAction(tabId, action.id)}
          className={`wd-icon relative ${action.enabled ? '' : 'opacity-40'}`}
          title={action.title || action.name}
          aria-label={action.title || action.name}
          data-testid={`extension-action-${action.id}`}
        >
          <img
            src={`chrome://extension-icon/${action.id}/32/1`}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4"
          />
          {action.badgeText && (
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 min-w-3 rounded-sm bg-[var(--wd-accent)] px-0.5 text-center text-[8px] font-bold leading-3 text-[var(--wd-accent-ink)]">
              {action.badgeText.slice(0, 4)}
            </span>
          )}
        </button>
      ))}
    </>
  )
}

function ExtensionsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Array<{ id: string; name: string; version: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const refresh = useCallback(() => {
    void window.agweb.extensions.list().then(setItems)
  }, [])
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const afterLoad = (result: { error?: string }): void => {
    if (result.error) setError(result.error)
    else setError(null)
    refresh()
  }

  const menuItem =
    'block w-full rounded-lg px-3 py-1.5 text-left text-[12px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]'

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon relative"
        title="Extensions"
        aria-label="Extensions"
        data-testid="extensions-button"
      >
        <ExtensionIcon />
      </button>
      {open && (
        <div className="glass absolute right-0 top-9 z-50 w-72 overflow-hidden rounded-[14px] p-1">
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--wd-dim)]">
            Extensions · this profile
          </p>

          {items.length === 0 && (
            <p className="px-3 py-1 text-[11px] text-[var(--wd-dim)]">None installed yet.</p>
          )}
          {items.map((ext) => (
            <div
              key={ext.id}
              className="group flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-[var(--wd-hover)]"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--wd-text)]">
                {ext.name}
                {ext.version && (
                  <span className="ml-1 text-[10px] text-[var(--wd-dim)]">v{ext.version}</span>
                )}
              </span>
              <button
                onClick={() => void window.agweb.extensions.remove(ext.id).then(refresh)}
                className="hidden flex-none text-[var(--wd-dim)] hover:text-rose-500 group-hover:block"
                title="Remove"
                aria-label={`Remove ${ext.name}`}
              >
                <CloseIcon size={13} />
              </button>
            </div>
          ))}

          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          <button
            className={menuItem}
            onClick={() => {
              setOpen(false)
              useShellStore.getState().newTab(CHROME_WEB_STORE_URL)
            }}
          >
            Browse the Chrome Web Store →
          </button>
          {window.agweb.host.ownsBrowserFeatures ? (
            // Chromium installs, updates and removes extensions itself — the Web
            // Store installs directly here, and chrome://extensions manages them.
            <>
              <button
                className={menuItem}
                onClick={() => {
                  setOpen(false)
                  useShellStore.getState().newTab('chrome://extensions/')
                }}
              >
                Manage extensions →
              </button>
              <p className="px-3 py-1.5 text-[10px] leading-relaxed text-[var(--wd-dim)]">
                Install from the Web Store directly; manage, update or remove them at
                chrome://extensions. Extensions apply to the current profile only.
              </p>
            </>
          ) : (
            <>
              <button
                className={menuItem}
                onClick={() => void window.agweb.extensions.load().then(afterLoad)}
              >
                Load unpacked extension…
              </button>
              <button
                className={menuItem}
                onClick={() => void window.agweb.extensions.loadPacked().then(afterLoad)}
              >
                Load a .crx or .zip…
              </button>
              {error && <p className="px-3 py-1 text-[10.5px] text-rose-500">{error}</p>}
              <p className="px-3 py-1.5 text-[10px] leading-relaxed text-[var(--wd-dim)]">
                The Web Store can’t install directly (Electron has no installer) — browse it, then
                load an unpacked or packed extension. Extensions apply to the current profile only.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Chrome's overflow menu — the settings entry point the design puts at the end
 * of the icon cluster, and which the app was missing entirely.
 */
function BrowserMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const proxyEnabled = useShellStore((s) => s.embedProxyEnabled)
  const setEmbedProxyEnabled = useShellStore((s) => s.setEmbedProxyEnabled)
  const addBlock = useShellStore((s) => s.addBlock)
  const theme = useShellStore((s) => s.theme)
  const setTheme = useShellStore((s) => s.setTheme)
  const ref = usePopover(
    open,
    useCallback(() => setOpen(false), [])
  )

  const item =
    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-[var(--wd-muted)] hover:bg-[var(--wd-hover)] hover:text-[var(--wd-text)]'

  return (
    <div ref={ref} className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="wd-icon"
        title="Menu"
        aria-label="Menu"
        data-testid="browser-menu"
      >
        <MoreVertIcon />
      </button>
      {open && (
        <div className="glass absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-[14px] py-1">
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              useShellStore.getState().newTab()
            }}
          >
            <span className="w-4 text-[var(--wd-dim)]">+</span> New tab
          </button>
          {/* Chromium's viewers, reached the only safe way: the browser shows
              the panel and opens what the user picked, so no path comes from
              this page. A PDF lands in its PDF viewer, annotation and all; a
              document lands in Document Studio, which Chromium has no
              equivalent of. */}
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              void openFileFromPicker().then((result) => {
                if (result.error) console.error('WebDeck: could not open that file —', result.error)
              })
            }}
            data-testid="menu-open-file"
          >
            <span className="w-4 text-[var(--wd-dim)]">↥</span> Open file…
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              useShellStore.getState().setSettingsOpen(true)
            }}
            data-testid="menu-settings"
          >
            <SettingsIcon size={15} className="text-[var(--wd-dim)]" /> Settings
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              addBlock('agents')
            }}
          >
            <PersonIcon size={15} className="text-[var(--wd-dim)]" /> Agent
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              addBlock('logs')
            }}
          >
            <HistoryIcon size={15} className="text-[var(--wd-dim)]" /> Logs
          </button>
          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          <button className={item} onClick={() => void window.agweb.extensions.load()}>
            <ExtensionIcon size={15} className="text-[var(--wd-dim)]" /> Load unpacked extension…
          </button>
          <button
            className={item}
            onClick={() =>
              void window.agweb.embedProxy
                .setEnabled(!proxyEnabled)
                .then((status) => setEmbedProxyEnabled(status.enabled))
            }
            aria-label="Toggle embed proxy"
          >
            <ShieldIcon size={15} />
            <span className={proxyEnabled ? 'text-[var(--wd-accent)]' : ''}>
              Embed proxy {proxyEnabled ? 'on' : 'off'}
            </span>
          </button>
          <div className="my-1 border-t border-[var(--wd-hairline)]" />
          <button className={item} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <IncognitoIcon size={15} className="text-[var(--wd-dim)]" />
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              void window.agweb.browser.openDevTools(useShellStore.getState().activeTabId)
            }}
          >
            <SplitscreenIcon size={15} className="text-[var(--wd-dim)]" /> Developer tools
          </button>
        </div>
      )}
    </div>
  )
}
