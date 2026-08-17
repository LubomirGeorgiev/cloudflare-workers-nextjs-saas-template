import { describe, expect, test, vi } from "vitest";

vi.mock("@/constants", () => ({
  LLMS_TXT_PATH: "/llms.txt",
  SITE_URL: "https://example.com",
}));

const { GET } = await import("./route");

describe("/docs/llms.txt", () => {
  test("redirects permanently to the root file", async () => {
    const response = await GET();

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://example.com/llms.txt");
  });
});
