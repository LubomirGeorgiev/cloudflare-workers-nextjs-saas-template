import { NextResponse } from "next/server";

import { SITE_URL } from "@/constants";
import { searchDocs } from "@/lib/cms/cms-search";
import { docsSearchQuerySchema } from "@/schemas/docs-search.schema";
import { v } from "@/lib/validation";
import { RateLimitError, RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

function withAbsoluteResolvedPath<T extends { resolvedPath: string }>(result: T): T {
  return {
    ...result,
    resolvedPath: new URL(result.resolvedPath, SITE_URL).toString(),
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parseResult = v.safeParse(docsSearchQuerySchema, {
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid docs search query",
        issues: parseResult.issues.map((issue) => issue.message),
      },
      {
        status: 400,
      }
    );
  }

  try {
    const results = await withRateLimit(async () => {
      const docsResults = await searchDocs({
        query: parseResult.output.q,
        limit: parseResult.output.limit,
      });

      return docsResults.map(withAbsoluteResolvedPath);
    }, RATE_LIMITS.DOCS_SEARCH);

    return NextResponse.json(
      {
        results,
      },
      {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      }
    );
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 429,
          headers: {
            "retry-after": String(error.retryAfterSeconds),
          },
        }
      );
    }

    throw error;
  }
}
