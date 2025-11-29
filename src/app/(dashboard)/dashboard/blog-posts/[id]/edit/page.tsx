import { PageHeader } from "@/components/page-header"
import { BlogPostEditor } from "../../_components/blog-post-editor"
import { notFound } from "next/navigation"
import { getPost } from "@/lib/blog-api"

export default async function BlogPostEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  try {
    const post = await getPost(id)
    
    if (post.status === "published") {
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
                label: "Edit"
              }
            ]}
          />
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
              <p className="text-destructive font-medium">
                Published posts cannot be edited. Please create a new post or unpublish this one first.
              </p>
            </div>
          </div>
        </>
      )
    }

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
              label: "Edit"
            }
          ]}
        />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <BlogPostEditor post={post} />
        </div>
      </>
    )
  } catch {
    notFound()
  }
}

