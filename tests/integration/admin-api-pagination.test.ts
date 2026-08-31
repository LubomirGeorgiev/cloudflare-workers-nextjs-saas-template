/// <reference types="@cloudflare/vitest-plugin/types" />

// Pagination on the internal listings, exercised as real requests over both surfaces. This is the
// gap `admin-api-route-policy.test.ts` cannot cover: it walks `adminApiApp.routes` structurally and
// never sends anything, so a query schema that rejects every explicit `?page=` still passes it.
//
// Both callers hand the validator a string. Hono's query map has no other type, and the MCP
// dispatcher stringifies every query argument on its way into the URL, so a numeric query field
// that does not coerce answers `INPUT_PARSE_ERROR` for a value it documents as valid.
//
// The listing under test is found in the internal document rather than named, so a fork that
// renames or replaces its own listings keeps this coverage.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, test, vi } from "vitest";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

import { ROLES_ENUM } from "@/app/enums";
import { adminApiApp } from "@/api/admin";
import { adminApiDocument } from "@/api/admin/generated-document";
import {
  ADMIN_MCP_PATH,
  DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  MAX_ADMIN_TABLE_PAGE_SIZE,
} from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable, userTable } from "@/db/schema";
import { ADMIN_SCOPE_NAMES } from "@/lib/api/admin-scopes";
import { deriveMcpTools } from "@/mcp/derive-tools";
import { generateApiKey } from "@/utils/api-key-format";

const { default: worker } = await import("../../worker-entrypoint");

const db = getDB();
const ORIGIN = "https://example.com";

// The two parameter names the internal listings share. They are the subject of this file, so they
// are stated rather than derived — a fork that renames them renames its own contract.
const PAGE_PARAM = "page";
const PAGE_SIZE_PARAM = "pageSize";

const REQUESTED_PAGE = 2;
// Deliberately different from the default, so a passing assertion proves the value travelled and
// was not supplied by the fallback. Clamped to the ceiling the schema publishes.
const REQUESTED_PAGE_SIZE = Math.min(
  DEFAULT_ADMIN_TABLE_PAGE_SIZE + 1,
  MAX_ADMIN_TABLE_PAGE_SIZE,
);

interface PageResponse {
  code?: string;
  errors?: { in: string; pointer: string; code: string }[];
  page?: number;
  pageSize?: number;
}

// A listing that needs nothing but its page pair: no path parameter, no other required argument.
const listing = deriveMcpTools({ document: adminApiDocument() }).find(
  (tool) =>
    tool.method === "GET"
    && tool.pathParams.length === 0
    && (tool.inputSchema.required ?? []).length === 0
    && tool.queryParams.includes(PAGE_PARAM)
    && tool.queryParams.includes(PAGE_SIZE_PARAM),
);

const skipWithoutListing = { skip: listing === undefined };

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/**
 * A live admin holding every internal scope. Written straight to D1 like the other API suites do:
 * `createAdminApiKey` proves a cookie session, which does not exist in the Workers test pool, and
 * what is under test here is the query boundary rather than the minting path.
 */
async function seedAdminKey(): Promise<string> {
  const userId = uid("usr");
  const generated = await generateApiKey();

  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: new Date(),
    role: ROLES_ENUM.ADMIN,
  });
  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    name: "admin pagination integration",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes: [...ADMIN_SCOPE_NAMES],
  });

  return generated.secret;
}

async function callListing({
  secret,
  query,
}: {
  secret: string;
  query?: string;
}): Promise<{ status: number; body: PageResponse }> {
  const response = await adminApiApp.fetch(
    new Request(`${ORIGIN}${listing?.path ?? ""}${query ? `?${query}` : ""}`, {
      headers: { authorization: `Bearer ${secret}` },
    }),
    env as Env,
    createExecutionContext(),
  );

  return { status: response.status, body: (await response.json()) as PageResponse };
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  structuredContent?: PageResponse;
  isError?: boolean;
}

// The stateless transport answers over SSE; one exchange carries exactly one message frame.
function readSseMessage(payload: string): { result?: unknown; error?: { message: string } } {
  const line = payload.split("\n").find((candidate) => candidate.startsWith("data: "));

  if (!line) {
    throw new Error(`No SSE message in response: ${payload}`);
  }

  return JSON.parse(line.slice("data: ".length)) as { result?: unknown; error?: { message: string } };
}

async function callAdminTool({
  secret,
  args,
}: {
  secret: string;
  args: Record<string, unknown>;
}): Promise<ToolCallResult> {
  const response = await worker.fetch(
    new Request(`${ORIGIN}${ADMIN_MCP_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: listing?.name, arguments: args },
      }),
    }),
    env as Env,
    createExecutionContext(),
  );

  expect(response.status).toBe(200);

  const message = readSseMessage(await response.text());

  expect(message.error).toBeUndefined();

  return message.result as ToolCallResult;
}

// A union base would publish `anyOf: [string, number]` here, telling every agent to send a string
// for a value the operation documents as a whole number. Coercion belongs in the schema, never in
// the contract.
test("the page pair is published as an integer, not as a string union", skipWithoutListing, () => {
  for (const name of [PAGE_PARAM, PAGE_SIZE_PARAM]) {
    const property = listing?.inputSchema.properties[name] as Record<string, unknown>;

    expect(property.type).toBe("integer");
    expect(property.anyOf).toBeUndefined();
  }
});

test("an explicit page and pageSize are accepted over REST", skipWithoutListing, async () => {
  const secret = await seedAdminKey();

  const { status, body } = await callListing({
    secret,
    query: `${PAGE_PARAM}=${REQUESTED_PAGE}&${PAGE_SIZE_PARAM}=${REQUESTED_PAGE_SIZE}`,
  });

  expect(body.code).toBeUndefined();
  expect(status).toBe(200);
  expect(body.page).toBe(REQUESTED_PAGE);
  expect(body.pageSize).toBe(REQUESTED_PAGE_SIZE);
});

test("an omitted page falls back to the documented defaults", skipWithoutListing, async () => {
  const secret = await seedAdminKey();

  const { status, body } = await callListing({ secret });

  expect(status).toBe(200);
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(DEFAULT_ADMIN_TABLE_PAGE_SIZE);
});

// Coercion must widen the accepted *format*, never the accepted range: a caller still cannot buy a
// bigger page or a fractional offset by sending it as a string.
test("a value outside the bounds is still refused", skipWithoutListing, async () => {
  const secret = await seedAdminKey();

  const refusals = [
    `${PAGE_PARAM}=0`,
    `${PAGE_PARAM}=1.5`,
    `${PAGE_PARAM}=not-a-number`,
    `${PAGE_SIZE_PARAM}=${MAX_ADMIN_TABLE_PAGE_SIZE + 1}`,
  ];

  for (const query of refusals) {
    const { status, body } = await callListing({ secret, query });

    // Asserted as one object so a failure names the query that produced it.
    expect({ query, status, code: body.code, location: body.errors?.[0]?.in }).toEqual({
      query,
      status: 400,
      code: "INPUT_PARSE_ERROR",
      location: "query",
    });
  }
});

// The dispatcher writes every query argument into the URL with `String(value)`, so a tool argument
// the SDK validated as a number still reaches the route as text.
test("an MCP tool call passing a numeric page reaches the listing", skipWithoutListing, async () => {
  const secret = await seedAdminKey();

  const result = await callAdminTool({
    secret,
    args: { [PAGE_PARAM]: REQUESTED_PAGE, [PAGE_SIZE_PARAM]: REQUESTED_PAGE_SIZE },
  });

  expect(result.isError).toBeFalsy();

  const payload = result.structuredContent ?? (JSON.parse(result.content[0]!.text) as PageResponse);

  expect(payload.page).toBe(REQUESTED_PAGE);
  expect(payload.pageSize).toBe(REQUESTED_PAGE_SIZE);
});
