import * as React from "react"

import { cn } from "@/lib/utils"
import type { Locale } from "@/i18n/config"

interface LocaleFlagProps {
  locale: Locale
  className?: string
}

// Inline flag SVGs, one per locale. Emoji flags (regional-indicator characters)
// don't render on Windows, so we self-host tiny public-domain SVGs (from the
// flag-icons set) instead of pulling the full ~250-flag library into the bundle.
// Add one entry here for every locale in LOCALES; the Record type enforces it.
// Spain uses the simplified civil ensign (no coat of arms) — the crest is
// unreadable at this size and its SVG is ~80KB, which would defeat the point.
const FLAG_SVGS: Record<Locale, React.ReactNode> = {
  en: (
    <svg viewBox="0 0 640 480" className="h-full w-full" role="presentation">
      <path fill="#bd3d44" d="M0 0h640v480H0" />
      <path
        stroke="#fff"
        strokeWidth="37"
        d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"
      />
      <path fill="#192f5d" d="M0 0h364.8v258.5H0" />
      <marker id="locale-flag-us-star" markerHeight="30" markerWidth="30">
        <path fill="#fff" d="m14 0 9 27L0 10h28L5 27z" />
      </marker>
      <path
        fill="none"
        markerMid="url(#locale-flag-us-star)"
        d="m0 0 16 11h61 61 61 61 60L47 37h61 61 60 61L16 63h61 61 61 61 60L47 89h61 61 60 61L16 115h61 61 61 61 60L47 141h61 61 60 61L16 166h61 61 61 61 60L47 192h61 61 60 61L16 218h61 61 61 61 60z"
      />
    </svg>
  ),
  es: (
    <svg viewBox="0 0 640 480" className="h-full w-full" role="presentation">
      <path fill="#AA151B" d="M0 0h640v480H0z" />
      <path fill="#F1BF00" d="M0 120h640v240H0z" />
    </svg>
  ),
}

export function LocaleFlag({ locale, className }: LocaleFlagProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 w-[1.35rem] shrink-0 items-center overflow-hidden rounded-[2px] ring-1 ring-black/10 dark:ring-white/15",
        className
      )}
    >
      {FLAG_SVGS[locale]}
    </span>
  )
}
