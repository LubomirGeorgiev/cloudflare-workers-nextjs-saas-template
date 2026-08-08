import { useRouter } from "next/navigation"
import { useCallback, useRef, type MouseEvent, type MouseEventHandler } from "react"

import { useUnmount } from "@/hooks/use-unmount"

interface NavigateAfterClose {
  /** Wire to a link's `onClick`: queues the destination, then closes the container. */
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
  /** Wire to the container's `onOpenChangeComplete`: flushes on close, cancels on re-open. */
  onOpenChangeComplete: (open: boolean) => void;
}

// Safety net only: `onOpenChangeComplete` is best-effort (Base UI drops it when the
// popup element resolves null), and a dropped callback would leave the link dead.
// Comfortably above the sheet's 300ms exit animation.
const NAVIGATION_FALLBACK_DELAY_MS = 600

// Modified and non-primary clicks mean "open in a new tab/window" — Next's own
// `<Link>` declines to intercept them, and so must anything layered on top.
function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/**
 * Defers a link's navigation until a closing overlay has finished animating out,
 * so the destination page does not render underneath a sheet still sliding away.
 */
export function useNavigateAfterClose(close: () => void): NavigateAfterClose {
  const router = useRouter()
  const pendingHrefRef = useRef<string | null>(null)
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    pendingHrefRef.current = null

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    const pendingHref = pendingHrefRef.current
    cancel()

    if (pendingHref) {
      router.push(pendingHref)
    }
  }, [cancel, router])

  useUnmount(cancel)

  const onNavigate: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (!isPlainPrimaryClick(event)) {
      return
    }

    event.preventDefault()

    // Queue the *resolved* href off the DOM rather than the typed route: it already
    // carries the locale prefix for localized links and none for app routes, so one
    // plain `useRouter` serves both. Typed-route checking ends at this boundary.
    const targetUrl = new URL(event.currentTarget.href)
    pendingHrefRef.current = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
    fallbackTimerRef.current = setTimeout(flush, NAVIGATION_FALLBACK_DELAY_MS)
    close()
  }

  const onOpenChangeComplete = (open: boolean) => {
    // A re-open is the cancellation signal — the user backed out of the destination.
    if (open) {
      cancel()
      return
    }

    flush()
  }

  return { onNavigate, onOpenChangeComplete }
}
