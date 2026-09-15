import { useEffect, useRef, useState } from 'react'
import { useShellStore } from '@/store'
import { StartPage } from '@/components/StartPage'
import { DocStudio } from '@/components/DocStudio'
import { VscodeEditorsSurface } from '@/components/VscodeEditorsSurface'
import { ReaderView } from '@/components/ReaderView'
import { splitView } from '../../../webui/shell'

/**
 * The stage hosts the active tab's page. With content, the main-process
 * WebContentsView is layered over this element — its bounds are streamed
 * here every frame of the Stage reveal animation, so the native view rides
 * the CSS transition. Without content, the start page renders in-DOM.
 */
/** Tab ids with a native-view creation in flight (module-scoped: it must
 *  survive the component's own remounts). */
const creating = new Set<string>()

/** How long the still stays under the returning live view (ms). The view's
 *  show is a cross-process round trip; the still covers it. */
const STILL_LINGER_MS = 150

/** A still of the page behind the stage, or '' when it cannot be copied. */
async function captureStill(tabId: string): Promise<string> {
  try {
    return await window.agweb.browser.captureStage(tabId)
  } catch {
    return ''
  }
}

export function Stage(): React.JSX.Element {
  const activeTabId = useShellStore((s) => s.activeTabId)
  const activeTab = useShellStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const hasContent = (activeTab?.kind === 'web' && activeTab.hasContent) ?? false
  const initialUrl = activeTab?.kind === 'web' ? activeTab.initialUrl : undefined
  const deckRevealed = useShellStore((s) => s.deckRevealed)
  const overlayCount = useShellStore((s) => s.overlayCount)
  const readerOpen = useShellStore((s) => s.readerOpen)
  const loadError = useShellStore((s) => s.browserStates[s.activeTabId]?.loadError)
  const splitTabId = useShellStore((s) => s.splitTabId)
  const splitRatio = useShellStore((s) => s.splitRatio)
  const ref = useRef<HTMLDivElement>(null)

  // Load link-opened tabs on first activation. `hasContent` only flips once
  // the async create resolves, so a second effect run (StrictMode remount, or
  // a re-render before the round-trip lands) would create a second native view
  // for the same tab — the in-flight set makes creation idempotent per tab.
  useEffect(() => {
    if (!initialUrl || hasContent || creating.has(activeTabId)) return
    creating.add(activeTabId)
    const { markTabHasContent } = useShellStore.getState()
    void window.agweb.browser
      .create(activeTabId)
      .then(() => {
        // The tab may have been closed while the create round-tripped: closeTab
        // saw hasContent===false and skipped browser.destroy, so the native view
        // would leak. Tear it down here rather than mark content on a dead tab.
        if (!useShellStore.getState().tabs.some((t) => t.id === activeTabId)) {
          void window.agweb.browser.destroy(activeTabId)
          return
        }
        markTabHasContent(activeTabId)
        void window.agweb.browser.navigate(activeTabId, initialUrl)
      })
      .catch((error: unknown) => {
        console.error('Failed to create browser view', error)
      })
      .finally(() => creating.delete(activeTabId))
  }, [activeTabId, initialUrl, hasContent])

  // Keep the native view glued to this element and visible only while its
  // tab is active. During the deck transition the element resizes every
  // frame, so the ResizeObserver streams bounds continuously.
  useEffect(() => {
    const el = ref.current
    if (!el || !hasContent) return

    const syncBounds = (): void => {
      const rect = el.getBoundingClientRect()
      if (!splitTabId) {
        void window.agweb.browser.setBounds(activeTabId, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        })
        return
      }
      // Split view: two live pages share the stage with a 6px grabbable gutter.
      // The primary rides the single stage (browser.setBounds); the secondary is
      // a distinct backend view positioned through its own Mojo channel — NOT
      // browser.setBounds, which only drives the one primary stage.
      const gutter = 6
      const left = Math.round((rect.width - gutter) * splitRatio)
      void window.agweb.browser.setBounds(activeTabId, {
        x: rect.x,
        y: rect.y,
        width: left,
        height: rect.height
      })
      void splitView.setSecondaryBounds({
        x: rect.x + left + gutter,
        y: rect.y,
        width: rect.width - left - gutter,
        height: rect.height
      })
    }

    syncBounds()
    // Shown as soon as it is glued on — unless an overlay is up, in which case
    // the overlay effect below owns visibility (it hides the view behind a still).
    void window.agweb.browser.setVisible(activeTabId, useShellStore.getState().overlayCount === 0)

    const observer = new ResizeObserver(syncBounds)
    observer.observe(el)
    window.addEventListener('resize', syncBounds)
    el.addEventListener('transitionend', syncBounds)
    // The stage-reveal animation (see styles.css) may briefly scale the DOM
    // frame; re-sync once it ends so the native view lands on the true rect.
    el.addEventListener('animationend', syncBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      el.removeEventListener('transitionend', syncBounds)
      el.removeEventListener('animationend', syncBounds)
      void window.agweb.browser.setVisible(activeTabId, false)
    }
  }, [activeTabId, hasContent, splitTabId, splitRatio])

  // Overlays. A menu, the palette or Settings renders in the DOM, and the native
  // view is composited above the DOM — so the view has to hide for the overlay
  // to show at all. Hiding it bare left the page blank behind every menu. Now
  // the stage first takes a still of the page (Shell.CaptureStage), paints it in
  // the view's place, and only then hides the view: the page keeps its content
  // for as long as the overlay is up. When the last overlay closes the view
  // comes back, and the still lingers under it for a beat so the swap never
  // shows the bare stage. A copy that fails hides bare, as before.
  // Both are kept per tab: the tab can change while an overlay is up (the tab
  // switcher IS an overlay), and the new tab must get its own still — never
  // the old tab's — and its own hide, not the old tab's leftover flag.
  const [still, setStill] = useState<{ tab: string; url: string } | null>(null)
  const hiddenFor = useRef<string | null>(null)
  useEffect(() => {
    if (!hasContent) return
    const hidden = hiddenFor.current === activeTabId
    if (overlayCount === 0) {
      if (hidden) {
        hiddenFor.current = null
        void window.agweb.browser.setVisible(activeTabId, true)
      }
      const timer = window.setTimeout(() => setStill(null), STILL_LINGER_MS)
      return () => window.clearTimeout(timer)
    }
    if (hidden) return
    let cancelled = false
    const hide = (): void => {
      if (cancelled) return
      hiddenFor.current = activeTabId
      void window.agweb.browser.setVisible(activeTabId, false)
    }
    void captureStill(activeTabId).then((url) => {
      if (cancelled) return
      if (!url) {
        hide()
        return
      }
      setStill({ tab: activeTabId, url })
      // Two frames: one for React to commit the <img>, one for it to paint
      // under the view — then the view can go without a blank in between.
      requestAnimationFrame(() => requestAnimationFrame(hide))
    })
    return () => {
      cancelled = true
    }
  }, [activeTabId, hasContent, overlayCount])

  // Split view: bind the companion tab into the secondary backend view when
  // split opens, and unbind on close. Kept separate from bounds streaming so
  // SetSplit fires once per split change, not on every divider-drag frame. Once
  // bound, the secondary view's visibility is the backend's to manage — the
  // shell never calls setVisible on the split tab (that would activate it in the
  // tab strip and steal it from the secondary pane).
  useEffect(() => {
    if (!splitTabId || !hasContent) return
    // The create round-trip can resolve after this effect re-ran or tore down,
    // which would bind() with stale ids. Guard both the content mark and the
    // bind on a per-run cancelled flag the cleanup sets.
    let cancelled = false
    const companion = useShellStore.getState().tabs.find((t) => t.id === splitTabId)
    const bind = (): void => void splitView.enable(activeTabId, splitTabId)
    if (companion && !companion.hasContent) {
      void window.agweb.browser
        .create(splitTabId)
        .then(() => {
          if (cancelled) return
          useShellStore.getState().markTabHasContent(splitTabId)
          if (companion.initialUrl) {
            void window.agweb.browser.navigate(splitTabId, companion.initialUrl)
          }
          bind()
        })
        .catch((error: unknown) => {
          console.error('Failed to create split companion view', error)
          useShellStore.getState().pushToast('Could not open the split view.', 'error')
        })
    } else {
      bind()
    }
    return () => {
      cancelled = true
      void splitView.disable()
    }
  }, [activeTabId, splitTabId, hasContent])

  // Round the native view's corners to match the spotlit stage frame.
  useEffect(() => {
    if (hasContent) void window.agweb.browser.setCornerRadius(activeTabId, deckRevealed ? 10 : 0)
  }, [activeTabId, hasContent, deckRevealed])

  return (
    // Keyed on the active tab so the CSS reveal (styles.css) replays each time a
    // different tab takes the stage, and once when the stage first mounts.
    <div key={activeTabId} ref={ref} className="stage bg-white dark:bg-[#101418]">
      {still && still.tab === activeTabId && hasContent && (
        <img
          className="stage-still"
          src={still.url}
          alt=""
          draggable={false}
          data-testid="stage-still"
        />
      )}
      {activeTab?.kind === 'doc' && activeTab.docPath ? (
        <DocStudio key={activeTab.id} path={activeTab.docPath} />
      ) : activeTab?.kind === 'editors' ? (
        <VscodeEditorsSurface key={activeTab.id} />
      ) : (
        !hasContent && <StartPage />
      )}
      {loadError && !splitTabId && <LoadError error={loadError} tabId={activeTabId} />}
      {splitTabId && <SplitDivider />}
      {readerOpen && hasContent && <ReaderView />}
    </div>
  )
}

/**
 * Why a page did not load.
 *
 * Without this a failed navigation leaves a blank stage and no explanation —
 * indistinguishable from the app simply not working. Chromium's own error
 * codes are unreadable, so the common ones get plain-language causes.
 */
const ERROR_CAUSES: Record<number, string> = {
  [-2]: 'The connection failed.',
  [-6]: 'That file does not exist.',
  [-7]: 'The server took too long to respond.',
  [-21]: 'The network changed while loading.',
  [-100]: 'The connection was closed.',
  [-102]: 'The server refused the connection.',
  [-105]: 'That address could not be resolved — check the spelling, or your DNS.',
  [-106]: 'This computer appears to be offline.',
  [-109]: 'The server is unreachable.',
  [-118]: 'The connection timed out.',
  [-137]: 'That address could not be resolved.'
}

function LoadError({
  error,
  tabId
}: {
  error: { code: number; description: string; url: string }
  tabId: string
}): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white p-8 text-center dark:bg-[#101418]"
      data-testid="page-load-error"
    >
      <div className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">
        This page didn&apos;t load
      </div>
      <div className="max-w-md text-[13px] leading-relaxed text-slate-500">
        {ERROR_CAUSES[error.code] ?? 'The page could not be reached.'}
      </div>
      <div className="max-w-lg truncate font-mono text-[11px] text-slate-400" title={error.url}>
        {error.url}
      </div>
      <button
        onClick={() => void window.agweb.browser.reload(tabId)}
        className="mt-1 rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-600"
      >
        Try again
      </button>
      <div className="font-mono text-[10px] text-slate-400">
        {error.description} ({error.code})
      </div>
    </div>
  )
}

/**
 * The grabbable divider between two split pages.
 *
 * It lives in the renderer's DOM over the gutter the bounds calculation
 * leaves; the native views sit either side of it, so there is nothing painted
 * above to fight with.
 */
function SplitDivider(): React.JSX.Element {
  const splitRatio = useShellStore((s) => s.splitRatio)
  const setSplitRatio = useShellStore((s) => s.setSplitRatio)
  const setSplit = useShellStore((s) => s.setSplit)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => {
      const stage = document.querySelector('.stage')?.getBoundingClientRect()
      if (!stage) return
      setSplitRatio((e.clientX - stage.left) / stage.width)
    }
    const end = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, setSplitRatio])

  return (
    <div
      className="absolute inset-y-0 z-20 flex w-1.5 cursor-col-resize items-center justify-center"
      style={{ left: `calc(${splitRatio * 100}% - 3px)` }}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDoubleClick={() => setSplit(null)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split view (double-click to close)"
      data-testid="split-divider"
    >
      <span
        className="h-10 w-1 rounded-full"
        style={{ background: dragging ? 'var(--wd-accent)' : 'var(--wd-glass-border)' }}
      />
    </div>
  )
}
