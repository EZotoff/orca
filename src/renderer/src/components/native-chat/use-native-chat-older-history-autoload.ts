// Pages in older history before the reader reaches the top. An IntersectionObserver
// rooted at the transcript scroller watches a sentinel above the first row, with a
// prefetch margin on top. It is the only geometry source and is recreated whenever
// a page settles, so its first report re-checks the range: paging continues while
// the sentinel stays in range and stops once a prepend pushes it out. Row
// measurement never asks for a page; the virtualizer keeps the reader's row in
// place across the prepend.

import { useEffect, useEffectEvent, useState } from 'react'

/** How far above the viewport the next page starts loading. The scroller's
 *  `zoom` may scale this, which changes only how early a page is asked for. */
export const NATIVE_CHAT_OLDER_HISTORY_PREFETCH_PX = 600

export type NativeChatOlderHistoryAutoload = {
  sentinelRef: (node: HTMLElement | null) => void
  /** False once a page failed (or the platform cannot observe); the list then
   *  offers a manual load instead. */
  isAutoLoadEnabled: boolean
  /** Manual load: clears a failure so auto-load resumes if it succeeds. */
  loadEarlierManually: () => void
}

export function useNativeChatOlderHistoryAutoload({
  scrollRef,
  historyKey,
  isVisible,
  hasMore,
  loadingEarlier,
  loadEarlier
}: {
  scrollRef: React.RefObject<HTMLElement | null>
  /** Identity of the transcript being paged; a failure belongs to one. */
  historyKey: string
  isVisible: boolean
  hasMore: boolean
  loadingEarlier: boolean
  /** Rejects when the page did not land; a no-op while a page is already in flight. */
  loadEarlier: () => Promise<void>
}): NativeChatOlderHistoryAutoload {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  // Keyed rather than a boolean so a swapped transcript never inherits the failure.
  const [failedHistoryKey, setFailedHistoryKey] = useState<string | null>(null)

  const canObserve = typeof IntersectionObserver !== 'undefined'
  const isAutoLoadEnabled = canObserve && failedHistoryKey !== historyKey
  const shouldObserve = isAutoLoadEnabled && isVisible && hasMore && !loadingEarlier

  // The lane owns "a page is in flight" and ignores a call while one is; a second
  // latch here would strand whenever the lane abandons a read that never settles.
  const loadPage = (): void => {
    void loadEarlier().catch(() => setFailedHistoryKey(historyKey))
  }
  // Lane callbacks change identity with their state; the observer must not.
  const loadPageFromObserver = useEffectEvent(loadPage)

  const loadEarlierManually = (): void => {
    setFailedHistoryKey(null)
    loadPage()
  }

  useEffect(() => {
    const root = scrollRef.current
    if (!shouldObserve || !sentinel || !root) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.at(-1)?.isIntersecting) {
          loadPageFromObserver()
        }
      },
      { root, rootMargin: `${NATIVE_CHAT_OLDER_HISTORY_PREFETCH_PX}px 0px 0px 0px` }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [scrollRef, sentinel, shouldObserve])

  return { sentinelRef: setSentinel, isAutoLoadEnabled, loadEarlierManually }
}
