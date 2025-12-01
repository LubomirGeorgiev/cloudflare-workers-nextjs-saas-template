import { PageHeader } from "@/components/page-header"
import { BlogPostsList } from "./_components/blog-posts-list"

export default function BlogPostsPage() {
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
          }
        ]}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <BlogPostsList />
      </div>
    </>
  )
}

