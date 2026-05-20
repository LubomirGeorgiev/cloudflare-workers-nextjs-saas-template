import type { ReactNode } from "react"

interface BlogLayoutProps {
  children: ReactNode
}

export default function BlogLayout({ children }: BlogLayoutProps) {
  return <div className="px-4 md:px-6 lg:px-8">{children}</div>
}
