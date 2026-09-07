/// <reference types="@cloudflare/vitest-plugin/types" />

// Real requests against local Miniflare KV: the route-policy test never sends one, so it cannot
// see that the purge deletes keys or that a read-only key is refused by the guard, not a validator.
// Paths come from the internal document, so a fork that remounts these routes keeps the coverage.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";

import { ROLES_ENUM } from "@/app/enums";
import { adminApiApp } from "@/api/admin";
import { adminApiDocument } from "@/api/admin/generated-document";
import { MARKDOWN_PAGE_CACHE_PREFIX, VINEXT_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { getDB } from "@/db";
import { apiKeyTable, userTable } from "@/db/schema";
import { ADMIN_SCOPE_NAMES } from "@/lib/api/admin-scopes";
import { deriveMcpTools } from "@/mcp/derive-tools";
import { generateApiKey } from "@/utils/api-key-format";

const db = getDB();
const ORIGIN = "https://example.com";

// The scope every write operation on this surface declares, and the read-only one that must not
// open it. Both are catalog names, so a fork that renames a scope renames its own contract.
const WRITE_SCOPE = "admin:write";
const READ_SCOPE = "admin:read";

const tools = deriveMcpTools({ document: adminApiDocument() });

// Asserted once at module level rather than guarding each test: a renamed operationId must fail
// the suite loudly, not skip it silently.
function pathOf(operationId: string): string {
  const path = tools.find((tool) => tool.operationId === operationId)?.path;

  if (path === undefined) {
    throw new Error(`No internal route is mounted for ${operationId}`);
  }

  return path;
}

const purgeKvPath = pathOf("adminPurgeKvPageCache");
const clearSearchCachePath = pathOf("adminClearSearchCache");

interface ProblemOrResult {
  code?: string;
  errors?: { in: string; pointer: string; code: string }[];
  message?: string;
  deletedKeyCount?: number;
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** Written straight to D1: `createAdminApiKey` needs a cookie session the Workers test pool cannot make. */
async function seedAdminKey(scopes: string[]): Promise<string> {
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
    name: "admin system integration",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes,
  });

  return generated.secret;
}

async function post({
  path,
  secret,
  body,
}: {
  path: string;
  secret: string;
  body?: unknown;
}): Promise<{ status: number; body: ProblemOrResult }> {
  const response = await adminApiApp.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as Env,
    createExecutionContext(),
  );

  return { status: response.status, body: (await response.json()) as ProblemOrResult };
}

test("purging the KV page cache deletes both prefixes and reports the count", async () => {
  const secret = await seedAdminKey([...ADMIN_SCOPE_NAMES]);
  const keys = [
    `${VINEXT_CACHE_PREFIX}:${uid("page")}`,
    `${MARKDOWN_PAGE_CACHE_PREFIX}${uid("md")}`,
  ];

  await Promise.all(keys.map((key) => env.KV_STORE.put(key, "cached", { expirationTtl: 60 })));

  const { status, body } = await post({ path: purgeKvPath, secret, body: { confirm: true } });

  expect(status).toBe(200);
  expect(body.deletedKeyCount).toBeGreaterThanOrEqual(keys.length);
  expect(typeof body.message).toBe("string");

  const remaining = await Promise.all(keys.map((key) => env.KV_STORE.get(key)));
  expect(remaining).toEqual([null, null]);
});

// The panel confirms a purge with a dialog; a machine caller states the same intent in the body.
// Without it the request is a located field error, and nothing is deleted.
test("a purge without the confirmation body is refused", async () => {
  const secret = await seedAdminKey([WRITE_SCOPE]);
  const key = `${VINEXT_CACHE_PREFIX}:${uid("page")}`;

  await env.KV_STORE.put(key, "cached", { expirationTtl: 60 });

  const empty = await post({ path: purgeKvPath, secret, body: {} });

  expect(empty.status).toBe(400);
  expect(empty.body.code).toBe("INPUT_PARSE_ERROR");
  expect(empty.body.errors?.map((error) => error.pointer)).toContain("/confirm");

  const missing = await post({ path: purgeKvPath, secret });

  expect(missing.status).toBe(400);
  expect(missing.body.code).toBe("INPUT_PARSE_ERROR");
  expect(await env.KV_STORE.get(key)).toBe("cached");
});

// The guard runs ahead of every validator, so a read-only credential is refused before it can learn
// anything about the operation it asked for.
test("a read-only admin credential cannot purge", async () => {
  const secret = await seedAdminKey([READ_SCOPE]);

  const { status, body } = await post({ path: purgeKvPath, secret, body: { confirm: true } });

  expect(status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
  expect(body.deletedKeyCount).toBeUndefined();
});

// The collection-scoped routes take a picklist, so an unknown slug is a located field error rather
// than a service failure — the validator answers and the maintenance work never starts.
test("an unknown collection is rejected", async () => {
  const secret = await seedAdminKey([WRITE_SCOPE]);

  const { status, body } = await post({
    path: clearSearchCachePath,
    secret,
    body: { collection: "__not-a-collection__" },
  });

  expect(status).toBe(400);
  expect(body.code).toBe("INPUT_PARSE_ERROR");
  expect(body.errors?.map((error) => error.pointer)).toContain("/collection");
});
