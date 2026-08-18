import "server-only";

import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import ms from "ms";

// The tag names stay import-free in `@/constants/cache-tags` so the Worker entrypoint can read
// them without this module's startup cost. Re-exported here, the historical home for them.
export { CACHE_TAGS } from "@/constants/cache-tags";

interface CacheScopeOptions {
  ttl: ms.StringValue; // e.g., "1h", "5m", "1d"
  tags?: string[];
}

export function setCacheScope({ ttl, tags }: CacheScopeOptions): void {
  const seconds = Math.floor(ms(ttl) / 1000);

  if (tags?.length) {
    cacheTag(...tags);
  }

  cacheLife({
    expire: seconds,
    revalidate: seconds,
  });
}

export async function revalidateCacheTag(tag: string): Promise<void> {
  try {
    await revalidateTag(tag, "max");
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) {
      return;
    }

    throw error;
  }
}
