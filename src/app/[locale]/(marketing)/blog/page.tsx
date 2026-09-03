import "server-only"
import type { Metadata } from "next"
import { BlogListPage, getBlogListPageMetadata } from "./_components/blog-list-page"
import type { Locale } from "@/i18n/config"

interface BlogPageProps {
  params: Promise<{
    locale: Locale;
  }>;
}

export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
  const { locale } = await params
  return getBlogListPageMetadata({ page: 1, locale })
}

// Deliberately reads no `searchParams`: pagination is path-based (`/blog/2`), so there is no
// query state this page needs.
export default async function BlogPage({ params }: BlogPageProps) {
  const { locale } = await params

  return <BlogListPage page={1} locale={locale} />
}
