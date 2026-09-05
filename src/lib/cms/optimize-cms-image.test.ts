import { describe, expect, test, vi } from "vitest";
import { CMS_IMAGES_API_ROUTE, CMS_IMAGES_BASE_PATH, IMAGE_OPTIMIZATION_PATH } from "@/constants";
import { CMS_IMAGE_QUALITY, IMAGE_DEVICE_SIZES } from "@/constants/images";
import { isCmsImageSource } from "@/utils/cms-image-source";

vi.mock("server-only", () => ({}));
const { optimizeCmsImage } = await import("./optimize-cms-image");

function fixture({ source = `${CMS_IMAGES_API_ROUTE}/${CMS_IMAGES_BASE_PATH}/blog/test.png`, width = IMAGE_DEVICE_SIZES[0], method = "GET" } = {}) {
  const request = new Request(`https://example.com${IMAGE_OPTIMIZATION_PATH}?${new URLSearchParams({
    url: source, w: String(width), q: String(CMS_IMAGE_QUALITY),
  })}`, { method, headers: { Accept: "image/webp" } });
  const fetchSource = vi.fn(async (__request: Request) => new Response("source", { headers: { "Content-Type": "image/png" } }));
  const output = vi.fn(async () => ({ response: () => new Response("optimized", { headers: { "Content-Type": "image/webp" } }) }));
  const transform = vi.fn(() => ({ output }));
  const images = { input: vi.fn(() => ({ transform })) } as unknown as ImagesBinding;
  return { request, fetchSource, images, output, transform };
}

describe("CMS image optimization", () => {
  test("reads the CMS route and preserves image negotiation and security headers", async () => {
    const input = fixture();
    const response = await optimizeCmsImage(input);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("optimized");
    expect(input.fetchSource.mock.calls[0]?.[0].url).toContain(CMS_IMAGES_API_ROUTE);
    expect(input.transform).toHaveBeenCalledWith({ width: IMAGE_DEVICE_SIZES[0] });
    expect(input.output).toHaveBeenCalledWith({ format: "image/webp", quality: CMS_IMAGE_QUALITY });
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  test("rejects unsupported widths before reading the source", async () => {
    const input = fixture({ width: -1 });
    expect((await optimizeCmsImage(input)).status).toBe(400);
    expect(input.fetchSource).not.toHaveBeenCalled();
  });

  test("does not fetch an application route after path normalization", async () => {
    const input = fixture({ source: `${CMS_IMAGES_API_ROUTE}/../../api/get-session` });
    expect((await optimizeCmsImage(input)).status).toBe(404);
    expect(input.fetchSource).not.toHaveBeenCalled();
  });

  test("keeps HEAD responses empty", async () => {
    const response = await optimizeCmsImage(fixture({ method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("isCmsImageSource", () => {
  const base = `https://example.com${IMAGE_OPTIMIZATION_PATH}`;

  test.each([
    [`${CMS_IMAGES_API_ROUTE}/${CMS_IMAGES_BASE_PATH}/blog/test.png`, true],
    [`https://example.com${CMS_IMAGES_API_ROUTE}/logo.png`, true],
    [`${CMS_IMAGES_API_ROUTE}/../../api/get-session`, false],
    [`https://attacker.example${CMS_IMAGES_API_ROUTE}/logo.png`, false],
    [CMS_IMAGES_API_ROUTE, false],
    ["/logo.png", false],
    ["", false],
  ])("resolves %s to %s", (source, expected) => {
    expect(isCmsImageSource({ source, base })).toBe(expected);
  });

  test("rejects a missing source", () => {
    expect(isCmsImageSource({ source: null, base: new URL(base) })).toBe(false);
  });
});
