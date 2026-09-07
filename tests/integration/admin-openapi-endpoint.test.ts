/// <reference types="@cloudflare/vitest-plugin/types" />

// `ADMIN_API_OPENAPI_PATH` through the real entrypoint, because only a real request shows that a
// cookie session gets past the OAuth provider's refusal. Contract: an admin reads the document, a
// non-admin cannot, and no refusal advertises the endpoint with a challenge header or is cacheable.
//
// The cookie door runs on the provider's 401 alone, so these tests also pin that status: if the
// library ever refused a credential-less request with anything else, the door would never run.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, test, vi } from "vitest";

import { ROLES_ENUM, type UserRole } from "@/app/enums";
import { adminApiDocument } from "@/api/admin/generated-document";
import { ADMIN_API_OPENAPI_PATH, SESSION_COOKIE_NAME } from "@/constants";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { getDB } from "@/db";
import { apiKeyTable, userTable } from "@/db/schema";
import { ADMIN_SCOPE_NAMES } from "@/lib/api/admin-scopes";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { generateApiKey } from "@/utils/api-key-format";
import { CURRENT_SESSION_VERSION } from "@/utils/kv-session";
import { createBase64UrlToken, hashToken } from "@/utils/random-token";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

const db = getDB();
const ORIGIN = "https://example.com";
const SESSION_TTL_SECONDS = 3600;

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedUser(role: UserRole): Promise<string> {
  const userId = uid("usr");

  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: new Date(),
    role,
  });

  return userId;
}

async function seedApiKey({ role, scopes }: { role: UserRole; scopes: string[] }): Promise<string> {
  const userId = await seedUser(role);
  const generated = await generateApiKey();

  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    name: "admin openapi endpoint",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes,
  });

  return generated.secret;
}

/** `createKVSession` needs a request scope the Workers test pool has none of, so the snapshot is
 * written straight to KV under the key `getKVSession` reads. */
async function seedSessionCookie(role: UserRole): Promise<string> {
  const userId = await seedUser(role);
  const token = createBase64UrlToken(48);
  const sessionId = await hashToken(token);

  await env.KV_STORE.put(
    `${APP_KV_PREFIXES.session}${userId}:${sessionId}`,
    JSON.stringify({
      id: sessionId,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
      user: { id: userId, email: `${userId}@example.com`, role },
      version: CURRENT_SESSION_VERSION,
    }),
    { expirationTtl: SESSION_TTL_SECONDS },
  );

  // Encoded as Next's `cookies().set()` serializes it, so the `:` arrives as `%3A` like in a browser.
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${userId}:${token}`)}`;
}

function request({
  cookie,
  method = "GET",
  secret,
}: {
  cookie?: string;
  method?: string;
  secret?: string;
} = {}): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${ADMIN_API_OPENAPI_PATH}`, {
      method,
      headers: {
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        ...(cookie ? { cookie } : {}),
      },
    }),
    env as Env,
    createExecutionContext(),
  );
}

/** Any operation the generated internal document actually declares, so a fork keeps the coverage. */
function anyInternalPath(): string | undefined {
  return Object.keys(adminApiDocument().paths ?? {})[0];
}

test("no credential is refused without advertising the endpoint", async () => {
  const response = await request();

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/problem+json");

  const problem = (await response.json()) as { code: string; detail: string };

  expect(problem.code).toBe("NOT_AUTHORIZED");
  expect(problem.detail).not.toContain(ADMIN_API_OPENAPI_PATH);
});

test("an admin bearer credential reads the internal document", async () => {
  const secret = await seedApiKey({ role: ROLES_ENUM.ADMIN, scopes: ["admin:read"] });

  const response = await request({ secret });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");

  const document = (await response.json()) as { paths?: Record<string, unknown> };
  const internalPath = anyInternalPath();

  expect(internalPath).toBeDefined();
  expect(Object.keys(document.paths ?? {})).toContain(internalPath);
});

test("a non-admin credential with public scopes is refused without a challenge", async () => {
  const secret = await seedApiKey({ role: ROLES_ENUM.USER, scopes: [API_SCOPE_NAMES[0]] });

  const response = await request({ secret });

  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()) as { code: string }).toMatchObject({ code: "FORBIDDEN" });
});

// Two independent facts, so the role alone opens nothing: the refusal names the missing scope only
// because the caller is staff, and a stranger never sees that sentence.
test("an admin holding no internal scope is refused", async () => {
  const secret = await seedApiKey({ role: ROLES_ENUM.ADMIN, scopes: [API_SCOPE_NAMES[0]] });

  const response = await request({ secret });
  const { detail } = (await response.json()) as { detail: string };

  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(ADMIN_SCOPE_NAMES.some((scope) => detail.includes(scope))).toBe(true);
});

// Several internal operations declare `admin:write` alone, so that key is mintable and has to see
// the document it would otherwise have to guess at.
test("a write-only admin credential reads the internal document", async () => {
  const secret = await seedApiKey({ role: ROLES_ENUM.ADMIN, scopes: ["admin:write"] });

  const response = await request({ secret });
  const document = (await response.json()) as { paths?: Record<string, unknown> };

  expect(response.status).toBe(200);
  expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
});

// The branch the provider cannot reach: a browser sends no bearer token, so this proves the
// entrypoint's cookie fallback runs rather than the provider's refusal standing.
test("an admin cookie session reads the internal document", async () => {
  const cookie = await seedSessionCookie(ROLES_ENUM.ADMIN);

  const response = await request({ cookie });

  expect(response.status).toBe(200);
  expect(Object.keys(((await response.json()) as { paths?: object }).paths ?? {}).length)
    .toBeGreaterThan(0);
});

test("a non-admin cookie session is refused without a challenge", async () => {
  const cookie = await seedSessionCookie(ROLES_ENUM.USER);

  const response = await request({ cookie });

  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()) as { code: string }).toMatchObject({ code: "FORBIDDEN" });
});

// The document is a static read, so an unsafe method falls through to the internal app's 404
// rather than answering with the whole internal surface.
test("a write method never serves the document", async () => {
  const secret = await seedApiKey({ role: ROLES_ENUM.ADMIN, scopes: ["admin:read"] });

  const response = await request({ method: "POST", secret });

  expect(response.status).toBe(404);
});

// The provider's own 401 names this path in a `WWW-Authenticate` challenge, so a method that never
// serves the document must still be answered by the endpoint rather than by the provider.
test("an unsafe method with no credential is refused without a challenge", async () => {
  const response = await request({ method: "POST" });

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect((await response.json()) as { code: string }).toMatchObject({ code: "NOT_AUTHORIZED" });
});

test("an unsafe method with an invalid bearer token is refused without a challenge", async () => {
  const response = await request({ method: "POST", secret: "not-a-real-credential" });

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/problem+json");
});
