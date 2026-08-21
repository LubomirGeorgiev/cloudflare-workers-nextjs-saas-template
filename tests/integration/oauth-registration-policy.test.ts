/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, test, vi } from "vitest";

import { OAUTH_OPEN_DCR_ENABLED, OAUTH_REGISTER_PATH } from "@/constants";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

const ORIGIN = "https://example.com";

function register(metadata: Record<string, unknown>): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}${OAUTH_REGISTER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata),
    }),
    env as Env,
    createExecutionContext(),
  );
}

async function expectDcrError({
  response,
  status,
  code,
}: {
  response: Response;
  status: number;
  code: string;
}): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toMatchObject({ error: code });
}

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "rejects unsafe redirect schemes with the RFC 7591 redirect error",
  async () => {
    const response = await register({
      client_name: "Unsafe Agent",
      redirect_uris: ["custom-agent://oauth/callback"],
      token_endpoint_auth_method: "none",
    });

    await expectDcrError({ response, status: 400, code: "invalid_redirect_uri" });
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "keeps native loopback redirects interoperable",
  async () => {
    for (const redirectUri of [
      "http://localhost:43123/oauth/callback",
      "http://127.0.0.1:43123/oauth/callback",
      "http://[::1]:43123/oauth/callback",
    ]) {
      const response = await register({
        client_name: "Native Agent",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(201);
    }
  },
);

test.skipIf(!OAUTH_OPEN_DCR_ENABLED)(
  "rejects oversized metadata with RFC-compatible errors",
  async () => {
    const [bodyResponse, nameResponse, redirectsResponse, metadataUriResponse] = await Promise.all([
      register({
        client_name: "Large Agent",
        redirect_uris: ["https://client.example.org/callback"],
        padding: "x".repeat(20_000),
      }),
      register({
        client_name: "x".repeat(500),
        redirect_uris: ["https://client.example.org/callback"],
      }),
      register({
        client_name: "Many Redirects Agent",
        redirect_uris: Array.from(
          { length: 20 },
          (_, index) => `https://client.example.org/callback/${index}`,
        ),
      }),
      register({
        client_name: "Long URI Agent",
        redirect_uris: ["https://client.example.org/callback"],
        client_uri: `https://client.example.org/${"x".repeat(3_000)}`,
      }),
    ]);

    await expectDcrError({ response: bodyResponse, status: 413, code: "invalid_client_metadata" });
    await expectDcrError({ response: nameResponse, status: 400, code: "invalid_client_metadata" });
    await expectDcrError({ response: redirectsResponse, status: 400, code: "invalid_redirect_uri" });
    await expectDcrError({
      response: metadataUriResponse,
      status: 400,
      code: "invalid_client_metadata",
    });
  },
);
