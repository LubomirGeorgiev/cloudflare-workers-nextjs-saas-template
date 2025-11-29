"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Save, Loader2, Eye } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updatePost, publishPost, type BlogPost, type UpdatePostData } from "@/lib/blog-api"

interface BlogPostEditorProps {
  post: BlogPost
}

export function BlogPostEditor({ post: initialPost }: BlogPostEditorProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [formData, setFormData] = useState<UpdatePostData>({
    title: initialPost.title,
    content: initialPost.content,
    status: initialPost.status,
  })

  const handleSave = async () => {
    if (!formData.title?.trim() || !formData.content?.trim()) {
      toast.error("Please fill in all required fields")
      return
    }

    try {
      setLoading(true)
      await updatePost(initialPost.id, formData)
      toast.success("Post updated successfully")
      router.push(`/dashboard/blog-posts/${initialPost.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update post")
    } finally {
      setLoading(false)
    }
  }

  const handlePublish = async () => {
    if (!confirm("Are you sure you want to publish this post? Published posts cannot be edited.")) {
      return
    }

    try {
      setPublishing(true)
      await publishPost(initialPost.id)
      toast.success("Post published successfully")
      router.push(`/dashboard/blog-posts/${initialPost.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish post")
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => router.push(`/dashboard/blog-posts/${initialPost.id}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/dashboard/blog-posts/${initialPost.id}`)}
          >
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button
            onClick={handlePublish}
            disabled={publishing || loading}
          >
            {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish
          </Button>
          <Button onClick={handleSave} disabled={loading || publishing}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Edit Post</CardTitle>
            <Badge variant={initialPost.status === "published" ? "default" : "secondary"}>
              {initialPost.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title || ""}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter post title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Content *</Label>
            <Textarea
              id="content"
              value={formData.content || ""}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Write your post content here..."
              rows={20}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              You can use Markdown formatting in your content
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

