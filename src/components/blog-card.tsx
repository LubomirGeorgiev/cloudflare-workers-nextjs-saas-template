import Link from "next/link"
import Image from "next/image"
import { formatDate } from "@/utils/format-date"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository"
import { getValidDateOrNow } from "@/utils/cms-entry-dates"

type BlogCardProps = {
  entry: GetCmsCollectionResult
  showTags?: boolean
  showAuthor?: boolean
}

export function BlogCard({ entry, showTags = true, showAuthor = true }: BlogCardProps) {
  const author = entry.createdByUser
  const authorName = author
    ? [author.firstName, author.lastName].filter(Boolean).join(' ') || author.email || 'Unknown'
    : 'Unknown'
  const description = entry.seoDescription?.trim()

  const displayDate = getValidDateOrNow({ value: entry.createdAt })

  return (
    <Link
      href={`/blog/${entry.slug}`}
      className="group block h-full"
    >
      <article className="h-full border rounded-lg overflow-hidden transition-all hover:shadow-lg hover:border-primary flex flex-col">
        {entry.featuredImageUrl && (
          <div className="relative aspect-video w-full overflow-hidden border-b">
            <Image
              src={entry.featuredImageUrl}
              alt={entry.featuredImage?.alt || entry.title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        )}

        <div className="p-6 flex h-full flex-col">
          <h2 className="text-2xl font-semibold mb-4 line-clamp-2 min-h-[4.5rem] group-hover:text-primary transition-all">
            {entry.title}
          </h2>

          {description && (
            <p className="text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[3.5rem]">
              {description}
            </p>
          )}

          {/* Tags */}
          {showTags && entry.tags && entry.tags.length > 0 && (
            <div className="mb-4 min-h-10 max-h-24 overflow-hidden flex flex-wrap gap-2">
              <CmsEntryTags tags={entry.tags} variant="outline" />
            </div>
          )}

          {/* Footer with author and date */}
          <div className="mt-auto pt-4 flex items-center justify-between gap-4 border-t">
            {/* Author info */}
            {showAuthor && author && (
              <div className="flex items-center gap-2 min-w-0">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(authorName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground truncate">
                  {authorName}
                </span>
              </div>
            )}

            <time
              dateTime={displayDate.toISOString()}
              className="text-sm text-muted-foreground whitespace-nowrap flex-shrink-0"
            >
              {formatDate(displayDate)}
            </time>
          </div>
        </div>
      </article>
    </Link>
  )
}
