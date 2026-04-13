"use server";

import { searchDocs } from "@/lib/cms/cms-search";
import { actionClient } from "@/lib/safe-action";
import { docsSearchQuerySchema } from "@/schemas/docs-search.schema";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export const searchDocsAction = actionClient
  .inputSchema(docsSearchQuerySchema)
  .action(async ({ parsedInput }) => {
    const results = await withRateLimit(async () => {
      return searchDocs({
        query: parsedInput.q,
        limit: parsedInput.limit,
      });
    }, RATE_LIMITS.DOCS_SEARCH);

    return { results };
  });
