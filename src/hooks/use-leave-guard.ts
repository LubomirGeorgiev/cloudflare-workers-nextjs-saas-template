"use client";

import { useEffect } from "react";

import useBeforeUnload from "@/hooks/use-before-unload";

/**
 * Asks before the user leaves the page while `enabled` returns true: the browser's own dialog on a
 * reload or tab close, and `message` in a confirm on an in-app link click.
 */
export function useLeaveGuard({
  enabled,
  message,
}: {
  enabled: () => boolean;
  message: string;
}) {
  useBeforeUnload(enabled);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;

      if (!(anchor instanceof HTMLAnchorElement) || !enabled()) {
        return;
      }

      const isGuarded = shouldGuardLinkClick({
        button: event.button,
        hasModifierKey: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        defaultPrevented: event.defaultPrevented,
        target: anchor.getAttribute("target"),
        hasDownload: anchor.hasAttribute("download"),
        href: anchor.href,
        currentHref: window.location.href,
      });

      if (isGuarded && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    // Capture on `window` runs before the `Link` handler that React attaches lower in the tree.
    window.addEventListener("click", handleClick, { capture: true });

    return () => window.removeEventListener("click", handleClick, { capture: true });
  }, [enabled, message]);
}

/**
 * Whether a link click would soft-navigate away from this page. New tabs, downloads, and other
 * origins leave this page open or go through `beforeunload`, so they are not asked about here.
 */
export function shouldGuardLinkClick(click: LinkClick): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.hasModifierKey || click.hasDownload) {
    return false;
  }

  if (click.target && click.target !== "_self") {
    return false;
  }

  const next = new URL(click.href, click.currentHref);
  const current = new URL(click.currentHref);

  return (
    next.origin === current.origin &&
    (next.pathname !== current.pathname || next.search !== current.search)
  );
}

interface LinkClick {
  button: number;
  hasModifierKey: boolean;
  defaultPrevented: boolean;
  target: string | null;
  hasDownload: boolean;
  href: string;
  currentHref: string;
}
