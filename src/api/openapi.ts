import "server-only";

import { resolver, type ResponsesWithResolver } from "hono-openapi";

import {
  buildApiInfo,
  buildApiSecuritySchemes,
  buildApiServers,
  buildApiTags,
} from "@/api/openapi-document";
import { PROBLEM_BY_CODE, PROBLEM_JSON_CONTENT_TYPE, type ProblemCode } from "@/lib/api/errors";
import { problemSchema } from "@/schemas/api/common.schema";

type SchemaInput = Parameters<typeof resolver>[0];

// Valibot pipes that have no JSON-Schema equivalent (transforms, custom actions) must degrade to
// a looser schema rather than throw and take the whole document down with them.
const VALIBOT_SCHEMA_OPTIONS = { errorMode: "ignore" } as const;

export function jsonResponse({
  description,
  schema,
}: {
  description: string;
  schema: SchemaInput;
}) {
  return {
    description,
    content: { "application/json": { schema: resolver(schema, VALIBOT_SCHEMA_OPTIONS) } },
  };
}

function problemResponse(description: string) {
  return {
    description,
    content: {
      [PROBLEM_JSON_CONTENT_TYPE]: { schema: resolver(problemSchema, VALIBOT_SCHEMA_OPTIONS) },
    },
  };
}

// Declared on every authenticated operation so an agent reading the document knows the failure
// modes without calling anything. All five share the RFC 9457 problem shape.
//
// Keyed by the catalog code that represents each status, so the status numbers are the catalog's
// and cannot drift from it. The description below documents the whole response class; the catalog's
// `detail` is the sentence one runtime failure sends back — different readers, different texts.
const COMMON_ERROR_DESCRIPTIONS = {
  INPUT_PARSE_ERROR: "The request body, query, or path failed validation.",
  NOT_AUTHORIZED: "The credential is missing, malformed, expired, or revoked.",
  FORBIDDEN: "The credential lacks the required scope or the caller lacks the team permission.",
  NOT_FOUND: "The addressed resource does not exist or is not visible to this credential.",
  RATE_LIMITED:
    "Rate limit exceeded; retry after the number of seconds in `retry-after`. The `RateLimit-*` headers describe the exhausted bucket.",
} as const satisfies Partial<Record<ProblemCode, string>>;

export const COMMON_ERROR_RESPONSES: ResponsesWithResolver = Object.fromEntries(
  Object.entries(COMMON_ERROR_DESCRIPTIONS).map(([code, description]) => [
    PROBLEM_BY_CODE[code as ProblemCode].status,
    problemResponse(description),
  ]),
);

// The one generator config. Read only at build time, by `scripts/generate-openapi.mjs`, which
// loads this module by path — so nothing in `src/` imports it and the linter cannot see the edge.
// oxlint-disable project/no-unused-module-exports -- Imported by the build-time generator.
// fallow-ignore-next-line unused-export -- Loaded by path from scripts/generate-openapi.mjs.
export function openApiGeneratorOptions() {
  return {
    documentation: {
      openapi: "3.1.0",
      info: buildApiInfo(),
      servers: buildApiServers(),
      tags: buildApiTags(),
      components: { securitySchemes: buildApiSecuritySchemes() },
    },
  };
}
// oxlint-enable project/no-unused-module-exports
