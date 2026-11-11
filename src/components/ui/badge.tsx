import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        // Same emerald and amber palettes as the matching alert variants, so one severity reads one way.
        success:
          "border-emerald-200/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100",
        warning:
          "border-amber-200/80 bg-amber-50/80 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// oxlint-disable-next-line project/no-unused-module-exports -- Shadcn/Radix modules intentionally expose optional composition slots.
export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export {
  Badge,
// oxlint-disable-next-line project/no-unused-module-exports -- Shadcn/Radix modules intentionally expose optional composition slots.
  badgeVariants
}
