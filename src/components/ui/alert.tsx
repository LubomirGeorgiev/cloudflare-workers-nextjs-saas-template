import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// oxlint-disable-next-line project/no-unused-module-exports -- Shadcn/Radix modules intentionally expose optional composition slots.
export const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground [&>svg]:text-foreground",
        info: "border-blue-200/80 bg-blue-50/80 text-blue-950 [&>svg]:text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100 dark:[&>svg]:text-blue-300",
        success:
          "border-emerald-200/80 bg-emerald-50/80 text-emerald-950 [&>svg]:text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100 dark:[&>svg]:text-emerald-300",
        warning:
          "border-amber-200/80 bg-amber-50/80 text-amber-950 [&>svg]:text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 dark:[&>svg]:text-amber-300",
        destructive:
          "border-destructive/50 bg-destructive/5 text-destructive dark:border-destructive/70 dark:bg-destructive/10 [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type AlertVariant = NonNullable<
  VariantProps<typeof alertVariants>["variant"]
>

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
