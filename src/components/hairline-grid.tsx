import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface HairlineGridProps {
  count: number
  children: ReactNode
}

// Hairline-divided grid (gap-px over the border color) matching the landing
// Features section. Filler cells keep an incomplete last row card-colored
// instead of exposing a border-colored slab; visibility is computed per
// breakpoint (2 columns at sm, 3 at lg).
export function HairlineGrid({ count, children }: HairlineGridProps) {
  const fillersSm = (2 - (count % 2)) % 2
  const fillersLg = (3 - (count % 3)) % 3

  return (
    <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {children}
      {Array.from({ length: Math.max(fillersSm, fillersLg) }, (_, index) => (
        <div
          key={index}
          aria-hidden
          className={cn(
            "hidden bg-card",
            index < fillersSm && "sm:block",
            index < fillersLg ? "lg:block" : "lg:hidden",
          )}
        />
      ))}
    </div>
  )
}
