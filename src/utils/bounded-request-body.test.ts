import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readBoundedJsonObject } = await import("@/utils/bounded-request-body");

const MAX_BYTES = 64;

describe("readBoundedJsonObject", () => {
  test("parses a JSON object and leaves the request body unread", async () => {
    const body = { message: "hello", count: 2 };
    const request = jsonRequest(JSON.stringify(body));

    await expect(readBoundedJsonObject({ request, maxBytes: MAX_BYTES })).resolves.toEqual(body);
    await expect(request.json()).resolves.toEqual(body);
  });

  test("refuses a body whose declared length is over the cap", async () => {
    const request = jsonRequest(JSON.stringify({ message: "x".repeat(MAX_BYTES) }));

    await expect(readBoundedJsonObject({ request, maxBytes: MAX_BYTES })).resolves.toBeNull();
  });

  // A chunked request can omit `content-length`, so the streamed read is the real bound.
  test("refuses a streamed body over the cap that declares no length", async () => {
    const chunk = new TextEncoder().encode(`{"message":"${"x".repeat(MAX_BYTES)}"}`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("https://example.test/", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(request.headers.get("content-length")).toBeNull();
    await expect(readBoundedJsonObject({ request, maxBytes: MAX_BYTES })).resolves.toBeNull();
  });

  test.each([
    { name: "an empty body", body: "" },
    { name: "invalid JSON", body: "{not json" },
    { name: "a JSON array", body: "[1,2]" },
    { name: "a JSON string", body: "\"text\"" },
    { name: "JSON null", body: "null" },
  ])("returns null for $name", async ({ body }) => {
    await expect(readBoundedJsonObject({ request: jsonRequest(body), maxBytes: MAX_BYTES }))
      .resolves.toBeNull();
  });

  test("returns null for a body that is not valid UTF-8", async () => {
    const request = new Request("https://example.test/", {
      method: "POST",
      body: new Uint8Array([0x7b, 0xff, 0x7d]),
    });

    await expect(readBoundedJsonObject({ request, maxBytes: MAX_BYTES })).resolves.toBeNull();
  });
});

function jsonRequest(body: string): Request {
  return new Request("https://example.test/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
    },
    body,
  });
}
