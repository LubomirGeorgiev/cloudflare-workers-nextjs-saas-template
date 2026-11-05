import { describe, expect, test, vi } from "vitest";

import { CMS_IMAGES_API_ROUTE, CMS_IMAGES_BASE_PATH } from "@/constants";
import { CMS_IMAGE_CACHE_CONTROL } from "@/constants/cache-control";
import { UPLOADED_MEDIA_CONTENT_SECURITY_POLICY } from "@/constants/images";

const { r2GetMock } = vi.hoisted(() => ({ r2GetMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: async () => ({ env: { R2_BUCKET: { get: r2GetMock } } }),
}));
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { CMS_IMAGES_API: {} },
  withRateLimit: (action: () => Promise<unknown>) => action(),
}));

const { GET } = await import("./route");

describe("GET /api/cms-images", () => {
  // An SVG opened directly would otherwise run its scripts on the app origin.
  test("serves an SVG with the sandbox policy and nosniff", async () => {
    const response = await serve({ key: "blog/icon.svg", contentType: "image/svg+xml", body: SVG_BODY });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Content-Security-Policy")).toBe(UPLOADED_MEDIA_CONTENT_SECURITY_POLICY);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe(SVG_BODY);
  });

  // The policy follows the stored type, so an SVG saved under a raster name gets it too.
  test("serves an SVG stored under a raster file name with the sandbox policy", async () => {
    const response = await serve({ key: "blog/icon.png", contentType: "image/svg+xml", body: SVG_BODY });

    expect(response.headers.get("Content-Security-Policy")).toBe(UPLOADED_MEDIA_CONTENT_SECURITY_POLICY);
  });

  test("serves a raster image unchanged with the same policy and the edge cache headers", async () => {
    const response = await serve({ key: "blog/photo.png", contentType: "image/png", body: "png-bytes" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe(CMS_IMAGE_CACHE_CONTROL);
    expect(response.headers.get("Content-Security-Policy")).toBe(UPLOADED_MEDIA_CONTENT_SECURITY_POLICY);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("png-bytes");
  });
});

async function serve({ key, contentType, body }: { key: string; contentType: string; body: string }) {
  const path = [CMS_IMAGES_BASE_PATH, ...key.split("/")];
  r2GetMock.mockResolvedValueOnce({
    body,
    httpEtag: "\"etag\"",
    httpMetadata: { contentType },
    uploaded: new Date(0),
  });

  return GET(new Request(`https://example.com${CMS_IMAGES_API_ROUTE}/${path.join("/")}`), {
    params: Promise.resolve({ path }),
  });
}

const SVG_BODY = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
