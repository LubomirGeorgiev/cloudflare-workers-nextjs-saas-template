import { afterEach, describe, expect, test, vi } from "vitest";

const { cacheLifeMock, cacheTagMock } = vi.hoisted(() => ({
  cacheLifeMock: vi.fn(),
  cacheTagMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  cacheLife: cacheLifeMock,
  cacheTag: cacheTagMock,
  revalidateTag: vi.fn(),
}));

const { getGithubStars } = await import("./stats");

describe("stats utilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("returns GitHub star count from the repository API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          stargazers_count: 771,
        }),
      ),
    );

    await expect(getGithubStars()).resolves.toBe(771);
  });

  test("returns null when the GitHub repository API rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 })),
    );

    await expect(getGithubStars()).resolves.toBeNull();
  });
});
