import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"
import { ButtonProps, buttonVariants } from "@/components/ui/button"

// Labels are required (no English defaults) so callers must supply localized
// copy; see BlogPaginationServer for the translated usage.
type PaginationProps = React.ComponentProps<"nav"> & {
  ariaLabel: string
}

const Pagination = ({
  className,
  ariaLabel,
  ...props
}: PaginationProps) => (
  <nav
    role="navigation"
    aria-label={ariaLabel}
    className={cn("mx-auto flex w-full justify-center", className)}
    {...props}
  />
)
Pagination.displayName = "Pagination"

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-row items-center gap-1", className)}
    {...props}
  />
))
PaginationContent.displayName = "PaginationContent"

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("", className)} {...props} />
))
PaginationItem.displayName = "PaginationItem"

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<ButtonProps, "size"> &
  React.ComponentProps<"a">

const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? "outline" : "ghost",
        size,
      }),
      className
    )}
    {...props}
  />
)
PaginationLink.displayName = "PaginationLink"

type PaginationNavButtonProps = React.ComponentProps<typeof PaginationLink> & {
  label: string
  ariaLabel: string
}

const PaginationPrevious = ({
  className,
  label,
  ariaLabel,
  ...props
}: PaginationNavButtonProps) => (
  <PaginationLink
    aria-label={ariaLabel}
    size="default"
    className={cn("gap-1 pl-2.5", className)}
    {...props}
  >
    <ChevronLeft className="h-4 w-4" />
    <span>{label}</span>
  </PaginationLink>
)
PaginationPrevious.displayName = "PaginationPrevious"

const PaginationNext = ({
  className,
  label,
  ariaLabel,
  ...props
}: PaginationNavButtonProps) => (
  <PaginationLink
    aria-label={ariaLabel}
    size="default"
    className={cn("gap-1 pr-2.5", className)}
    {...props}
  >
    <span>{label}</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
)
PaginationNext.displayName = "PaginationNext"

type PaginationEllipsisProps = React.ComponentProps<"span"> & {
  label: string
}

const PaginationEllipsis = ({
  className,
  label,
  ...props
}: PaginationEllipsisProps) => (
  <span
    className={cn("flex h-9 w-9 items-center justify-center", className)}
    {...props}
  >
    <MoreHorizontal aria-hidden className="h-4 w-4" />
    <span className="sr-only">{label}</span>
  </span>
)
PaginationEllipsis.displayName = "PaginationEllipsis"

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
