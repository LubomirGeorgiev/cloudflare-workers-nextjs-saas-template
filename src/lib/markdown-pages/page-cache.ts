import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { getBuildId } from "@/utils/build-id";

// The one key rule for converted page Markdown: the Worker branch writes it and a CMS publish
// purges it, so a second copy of this template would make a publish miss keys.
export function buildMarkdownPageCacheKey({ pathname }: { pathname: string }): string {
  return `${MARKDOWN_PAGE_CACHE_PREFIX}${getBuildId()}:${pathname}`;
}
