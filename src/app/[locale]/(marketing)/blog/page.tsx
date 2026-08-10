import "server-only"
import type { Metadata } from "next"
import { BlogListPage, getBlogListPageMetadata } from "./_components/blog-list-page"
import type { Locale } from "@/i18n/config"

interface BlogPageProps {
  params: Promise<{
    locale: Locale;
  }>;
}

// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;

export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
  const { locale } = await params
  return getBlogListPageMetadata({ page: 1, locale })
}

// Deliberately reads no `searchParams`: one such read opts the whole route out of ISR. Pagination
// is path-based (`/blog/2`), so there is no query state this page needs.
export default async function BlogPage({ params }: BlogPageProps) {
  const { locale } = await params

  return <BlogListPage page={1} locale={locale} />
}
