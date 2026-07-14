import { Link } from "@/i18n/navigation"
import type { ComponentProps } from "react"

interface BlogBackLinkProps {
  href: ComponentProps<typeof Link>["href"]
  label: string
}

export function BlogBackLink({ href, label }: BlogBackLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-edge"
    >
      {label}
    </Link>
  )
}
