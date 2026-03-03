import "server-only"
import { redirect } from "next/navigation"
import { BlogListPage, getBlogListPageMetadata } from "./_components/blog-list-page"
import { getBlogPagePath } from "@/lib/blog-routing"
import { getValidPageNumber } from "@/utils/get-valid-page-number"

export const metadata = getBlogListPageMetadata({ page: 1 })

interface BlogPageProps {
  searchParams: Promise<{
    page?: string;
  }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const params = await searchParams;
  const validPageNumber = getValidPageNumber({ value: params.page })

  if (validPageNumber) {
    redirect(getBlogPagePath({ page: validPageNumber }))
  }

  return <BlogListPage page={1} />
}
