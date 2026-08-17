import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";

declare const __MARKDOWN_BUILD_ID__: string;

// No fallback on purpose: without the build id every deploy would share one key space, so the
// implicit purge on deploy would stop happening silently.
function markdownBuildId(): string {
  const injected = __MARKDOWN_BUILD_ID__.trim();

  if (!injected) {
    throw new Error("Markdown build id was not injected by the build.");
  }

  return injected;
}

// The one key rule for converted page Markdown: the Worker branch writes it and a CMS publish
// purges it, so a second copy of this template would make a publish miss keys.
export function buildMarkdownPageCacheKey({ pathname }: { pathname: string }): string {
  return `${MARKDOWN_PAGE_CACHE_PREFIX}${markdownBuildId()}:${pathname}`;
}
