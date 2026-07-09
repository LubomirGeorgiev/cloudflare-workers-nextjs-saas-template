import "server-only"
import type { Metadata } from "next"
import { redirect } from "@/i18n/navigation"
import { BlogListPage, getBlogListPageMetadata } from "./_components/blog-list-page"
import { getBlogPagePath } from "@/lib/blog-routing"
import { getValidPageNumber } from "@/utils/get-valid-page-number"
import type { Locale } from "@/i18n/config"

interface BlogPageProps {
  params: Promise<{
    locale: Locale;
  }>;
  searchParams: Promise<{
    page?: string;
  }>;
}

export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
  const { locale } = await params
  return getBlogListPageMetadata({ page: 1, locale })
}

export default async function BlogPage({ params, searchParams }: BlogPageProps) {
  const { locale } = await params
  const search = await searchParams;
  const validPageNumber = getValidPageNumber({ value: search.page })

  if (validPageNumber) {
    redirect({ href: getBlogPagePath({ page: validPageNumber }), locale })
  }

  return <BlogListPage page={1} locale={locale} />
}
