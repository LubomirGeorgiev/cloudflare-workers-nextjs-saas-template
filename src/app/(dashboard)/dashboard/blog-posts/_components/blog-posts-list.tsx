"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Search, Edit, Trash2, Eye, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { getPosts, deletePost, type BlogPost, type PaginatedPosts, getImageUrl } from "@/lib/blog-api"
import { CreatePostDialog } from "./create-post-dialog"
import { GeneratePostDialog } from "./generate-post-dialog"
import { formatDistanceToNow } from "date-fns"

export function BlogPostsList() {
  const router = useRouter()
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalResults, setTotalResults] = useState(0)
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true)
      const data: PaginatedPosts = await getPosts({
        page,
        limit: 10,
        sortBy: "createdAt:desc",
        status: statusFilter !== "all" ? statusFilter : undefined,
        title: searchQuery || undefined,
      })
      setPosts(data.results)
      setTotalPages(data.totalPages)
      setTotalResults(data.totalResults)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load blog posts")
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, searchQuery])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
      return
    }

    try {
      setDeletingId(id)
      await deletePost(id)
      toast.success("Post deleted successfully")
      fetchPosts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete post")
    } finally {
      setDeletingId(null)
    }
  }

  const handlePublish = async (id: string) => {
    try {
      const { publishPost } = await import("@/lib/blog-api")
      await publishPost(id)
      toast.success("Post published successfully")
      fetchPosts()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish post")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Blog Posts</h1>
          <p className="text-muted-foreground">
            Manage your blog posts and content
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setGenerateDialogOpen(true)}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Generate with AI
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Post
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Posts</SelectItem>
            <SelectItem value="draft">Drafts</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No posts found</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create your first post
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Card key={post.id} className="hover:shadow-md transition-shadow">
                {post.featuredImageUrl && (
                  <div className="relative w-full h-48 overflow-hidden rounded-t-lg">
                    <img
                      src={
                        post.featuredImageUrl.startsWith("http") 
                          ? post.featuredImageUrl 
                          : getImageUrl(post.featuredImageUrl.startsWith("/images/") 
                            ? post.featuredImageUrl.replace("/images/", "") 
                            : post.featuredImageUrl)
                      }
                      alt={post.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                )}
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="line-clamp-2">{post.title}</CardTitle>
                    <Badge variant={post.status === "published" ? "default" : "secondary"}>
                      {post.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                    {post.content.replace(/[#*\[\]()]/g, "").substring(0, 150)}...
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/dashboard/blog-posts/${post.id}`)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                    {post.status === "draft" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/blog-posts/${post.id}/edit`)}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePublish(post.id)}
                        >
                          Publish
                        </Button>
                      </>
                    )}
                    {post.status === "draft" && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(post.id)}
                        disabled={deletingId === post.id}
                      >
                        {deletingId === post.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {posts.length} of {totalResults} posts
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="flex items-center px-4 text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <CreatePostDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={fetchPosts}
      />

      <GeneratePostDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onSuccess={fetchPosts}
      />
    </div>
  )
}

