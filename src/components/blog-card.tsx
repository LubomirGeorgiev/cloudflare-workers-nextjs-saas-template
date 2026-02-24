import Link from "next/link"
import { formatDate } from "@/utils/format-date"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository"

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

  // Safely handle date
  const displayDate = entry.createdAt instanceof Date && !isNaN(entry.createdAt.getTime())
    ? entry.createdAt
    : new Date()

  return (
    <Link
      href={`/blog/${entry.slug}`}
      className="group block"
    >
      <article className="h-full border rounded-lg p-6 transition-all hover:shadow-lg hover:border-primary flex flex-col">
        <h2 className="text-2xl font-semibold mb-4 group-hover:text-primary transition-all">
          {entry.title}
        </h2>

        {/* Tags */}
        {showTags && entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
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
      </article>
    </Link>
  )
}
