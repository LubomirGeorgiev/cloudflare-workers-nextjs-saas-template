import { PageHeader } from "@/components/page-header"
import { BlogPostDetail } from "../_components/blog-post-detail"
import { notFound } from "next/navigation"
import { getPost } from "@/lib/blog-api"

export default async function BlogPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  try {
    const post = await getPost(id)
    return (
      <>
        <PageHeader
          items={[
            {
              href: "/dashboard",
              label: "Dashboard"
            },
            {
              href: "/dashboard/blog-posts",
              label: "Blog Posts"
            },
            {
              href: `/dashboard/blog-posts/${id}`,
              label: post.title
            }
          ]}
        />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <BlogPostDetail post={post} />
        </div>
      </>
    )
  } catch {
    notFound()
  }
}

