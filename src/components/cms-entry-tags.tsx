import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository";

type CmsTag = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
};

type CmsEntryTagsProps = {
  tags: GetCmsCollectionResult["tags"];
  maxTags?: number;
  variant?: "outline" | "secondary";
  emptyText?: string;
  linkHref?: (tag: CmsTag) => string;
};

export function CmsEntryTags({
  tags,
  maxTags = 3,
  variant = "outline",
  emptyText,
  linkHref,
}: CmsEntryTagsProps) {
  const badgeClassName =
    "text-xs border shadow-sm dark:shadow-[0_1px_4px_0_rgba(255,255,255,0.1)]";

  if (!tags || tags.length === 0) {
    return emptyText ? (
      <span className="text-muted-foreground text-sm">{emptyText}</span>
    ) : null;
  }

  const displayedTags = tags.slice(0, maxTags);
  const remainingCount = tags.length - maxTags;

  const renderBadge = (tag: CmsTag) => {
    const badge = (
      <Badge
        variant={variant}
        className={badgeClassName}
        style={
          tag.color
            ? variant === "outline"
              ? {
                  backgroundColor: `${tag.color}20`,
                  borderColor: tag.color,
                }
              : {
                  backgroundColor: tag.color,
                  color: "white",
                }
            : undefined
        }
      >
        {tag.name}
      </Badge>
    );

    if (linkHref) {
      return (
        <Link key={tag.id} href={linkHref(tag) as never}>
          {badge}
        </Link>
      );
    }

    return badge;
  };

  return (
    <>
      {displayedTags.map(({ tag }) => (
        <span key={tag.id}>{renderBadge(tag)}</span>
      ))}
      {remainingCount > 0 && (
        <span>
          <Badge variant="outline" className={badgeClassName}>
            +{remainingCount}
            {variant === "secondary" && " more"}
          </Badge>
        </span>
      )}
    </>
  );
}
