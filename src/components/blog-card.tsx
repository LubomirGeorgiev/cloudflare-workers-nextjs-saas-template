import Image from "next/image"
import { getTranslator } from "@/i18n/translator";
import type { Locale } from "@/i18n/config"
import { Link } from "@/i18n/navigation"
import { formatDate } from "@/utils/format-date"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getInitials } from "@/utils/name-initials"
import { CmsEntryTags } from "@/components/cms-entry-tags"
import { MARKDOWN_DIRECTIVES } from "@/constants/markdown-directives"
import type { CmsCollectionListItem } from "@/lib/cms/entry"
import { getValidDateOrNow } from "@/utils/cms-entry-dates"
import { getAuthorDisplayName } from "@/utils/blog-author-url"

type BlogCardProps = {
  entry: CmsCollectionListItem
  locale: Locale
  showTags?: boolean
  showAuthor?: boolean
}

export async function BlogCard({ entry, locale, showTags = true, showAuthor = true }: BlogCardProps) {
  const t = await getTranslator({ locale, namespace: "Blog.AuthorDetail" })
  const author = entry.createdByUser
  const authorName = author
    ? getAuthorDisplayName(author, t("unknownAuthor"))
    : t("unknownAuthor")
  const description = entry.seoDescription?.trim()

  const displayDate = getValidDateOrNow({ value: entry.createdAt })

  return (
    <Link
      href={`/blog/${entry.slug}`}
      className="group block h-full"
    >
      <article className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-edge/50">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 z-10 h-px scale-x-0 bg-edge transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none"
        />
        {entry.featuredImageUrl && (
          <div className="relative aspect-video w-full overflow-hidden border-b">
            <Image
              src={entry.featuredImageUrl}
              alt={entry.featuredImage?.alt || entry.title}
              fill
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transform-none"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        )}

        <div className="flex flex-1 flex-col p-6">
          <time
            dateTime={displayDate.toISOString()}
            className="font-mono text-xs uppercase tracking-wide text-muted-foreground"
          >
            {formatDate(displayDate, locale)}
          </time>

          <h2 className="mt-3 line-clamp-2 font-display text-xl font-semibold leading-snug text-foreground transition-colors group-hover:text-edge">
            {entry.title}
          </h2>

          {description && (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}

          {showTags && entry.tags && entry.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <CmsEntryTags tags={entry.tags} variant="outline" />
            </div>
          )}

          {showAuthor && author && (
            <div className="mt-auto pt-5">
              <div className="flex items-center gap-2.5 border-t pt-4">
                {/* The name next to it is the author; the initials would only repeat it. */}
                <Avatar
                  aria-hidden
                  data-markdown={MARKDOWN_DIRECTIVES.skip}
                  className="h-7 w-7 flex-shrink-0"
                >
                  {author.avatar && <AvatarImage src={author.avatar} alt={authorName} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(authorName)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm text-muted-foreground">
                  {authorName}
                </span>
              </div>
            </div>
          )}
        </div>
      </article>
    </Link>
  )
}
