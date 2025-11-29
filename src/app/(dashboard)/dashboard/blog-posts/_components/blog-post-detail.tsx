"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Edit, ArrowLeft, Calendar } from "lucide-react"
import { useRouter } from "next/navigation"
import { type BlogPost } from "@/lib/blog-api"
import { format } from "date-fns"
import { getImageUrl } from "@/lib/blog-api"

interface BlogPostDetailProps {
  post: BlogPost
}

export function BlogPostDetail({ post }: BlogPostDetailProps) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard/blog-posts")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Posts
        </Button>
        {post.status === "draft" && (
          <Button
            onClick={() => router.push(`/dashboard/blog-posts/${post.id}/edit`)}
          >
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-3xl mb-2">{post.title}</CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(post.createdAt), "PPP")}
                </div>
                <Badge variant={post.status === "published" ? "default" : "secondary"}>
                  {post.status}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {post.featuredImageUrl && (
            <div className="mb-6">
              <img
                src={
                  post.featuredImageUrl.startsWith("http") 
                    ? post.featuredImageUrl 
                    : getImageUrl(post.featuredImageUrl.startsWith("/images/") 
                      ? post.featuredImageUrl.replace("/images/", "") 
                      : post.featuredImageUrl)
                }
                alt={post.title}
                className="w-full h-auto rounded-lg object-cover"
                onError={(e) => {
                  console.error("Failed to load featured image:", post.featuredImageUrl);
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          )}
          <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
            {post.content.split('\n').map((line, index) => {
              // Handle markdown images
              const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/)
              if (imageMatch) {
                const [, alt, url] = imageMatch
                const imageUrl = url.startsWith("http") 
                  ? url 
                  : getImageUrl(url.startsWith("/images/") 
                    ? url.replace("/images/", "") 
                    : url)
                return (
                  <img
                    key={index}
                    src={imageUrl}
                    alt={alt}
                    className="rounded-lg my-4 w-full h-auto"
                    onError={(e) => {
                      console.error("Failed to load image:", url);
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )
              }
              // Handle regular text
              return <p key={index} className="mb-4">{line || '\u00A0'}</p>
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

