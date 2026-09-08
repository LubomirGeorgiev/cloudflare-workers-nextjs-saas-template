import { describe, expect, it } from "vitest";

import {
  parseDeploySizeMetrics,
  parseStartupProfileMetrics,
  parseTtfbMetrics,
  toBytes,
} from "./metrics.mjs";

const DEPLOY_OUTPUT = `
Total Upload: 8352.31 KiB / gzip: 1865.68 KiB
Uploaded worker (12.34 sec)
`;

// Verbatim \`wrangler check startup\` output, box-drawing prefixes included.
const STARTUP_OUTPUT = `
├ Analysing
│ Startup phase analysed
│
│ Bundle: 6326.88 KiB / gzip: 1587.13 KiB
│
│ Local startup profile:
│   Profile window: 157.2 ms
│   Sampled time: 150.1 ms
│   Active: 25.1 ms (including 2.5 ms garbage collection)
│   Idle: 125.0 ms
│   Samples: 21
│
│ CPU Profile has been written to worker-startup.cpuprofile.
`;

// Verbatim `node scripts/measure-ttfb.mjs` output, one line per measured route. The `cache=` field
// names both layers: Workers Caching, then the stored HTML copy inside the Worker.
const TTFB_OUTPUT = `
TTFB base=https://example.test warmSamples=3
TTFB target=rootRedirect path=/ status=307 cold=142.7 ms warm=38.2 ms cache=DYNAMIC/-
TTFB target=home path=/en status=200 cold=311.4 ms warm=96 ms cache=-/miss
TTFB target=docsRoot path=/en/docs status=200 cold=280.1 ms warm=88.5 ms cache=BYPASS/hit
TTFB skipped target=blogEntry reason=no blog entry in the sitemap
TTFB JSON: {"baseUrl":"https://example.test","targets":[]}
`;

describe("toBytes", () => {
  it("uses 1024 for binary units and 1000 for decimal units", () => {
    expect(toBytes("1", "KiB")).toBe(1024);
    expect(toBytes("1", "kB")).toBe(1000);
    expect(toBytes("1.5", "MiB")).toBe(1572864);
    expect(toBytes("42", "B")).toBe(42);
  });

  it("rejects unknown units", () => {
    expect(() => toBytes("1", "PiB")).toThrow(/Unsupported size unit/);
  });
});

describe("parseDeploySizeMetrics", () => {
  it("extracts raw and byte sizes", () => {
    expect(parseDeploySizeMetrics(DEPLOY_OUTPUT)).toEqual({
      totalUploadRaw: "8352.31 KiB",
      gzipRaw: "1865.68 KiB",
      totalUploadBytes: 8552765,
      gzipBytes: 1910456,
    });
  });

  it("ignores ANSI colour codes", () => {
    const colored = "\u001b[32mTotal Upload:\u001b[0m 100 KiB / gzip: 50 KiB";

    expect(parseDeploySizeMetrics(colored).totalUploadBytes).toBe(102400);
  });

  it("throws when the deploy output has no size line", () => {
    expect(() => parseDeploySizeMetrics("Uploaded worker")).toThrow(/deploy size metrics/);
  });
});

describe("parseStartupProfileMetrics", () => {
  it("extracts bundle sizes and profile timings under startup-prefixed keys", () => {
    expect(parseStartupProfileMetrics(STARTUP_OUTPUT)).toEqual({
      startupBundleRaw: "6326.88 KiB",
      startupGzipRaw: "1587.13 KiB",
      startupBundleBytes: 6478725,
      startupGzipBytes: 1625221,
      startupProfileWindowMs: 157.2,
      startupSampledMs: 150.1,
      startupActiveMs: 25.1,
      startupGcMs: 2.5,
      startupIdleMs: 125,
      startupSamples: 21,
    });
  });

  it("keeps startup keys disjoint from the deploy size keys they share a row with", () => {
    const overlap = Object.keys(parseStartupProfileMetrics(STARTUP_OUTPUT)).filter((key) =>
      Object.keys(parseDeploySizeMetrics(DEPLOY_OUTPUT)).includes(key)
    );

    expect(overlap).toEqual([]);
  });

  it("records a null gc time when nothing was collected", () => {
    const withoutGc = STARTUP_OUTPUT.replace(
      "Active: 25.1 ms (including 2.5 ms garbage collection)",
      "Active: 25.1 ms"
    );

    expect(parseStartupProfileMetrics(withoutGc).startupGcMs).toBeNull();
  });

  it("throws when a timing line is missing", () => {
    const withoutIdle = STARTUP_OUTPUT.replace("│   Idle: 125.0 ms\n", "");

    expect(() => parseStartupProfileMetrics(withoutIdle)).toThrow(/Idle/);
  });

  it("throws when the bundle line is missing", () => {
    expect(() => parseStartupProfileMetrics("Startup phase analysed")).toThrow(/bundle size/);
  });
});

describe("parseTtfbMetrics", () => {
  it("extracts cold and warm timings under ttfb-prefixed keys", () => {
    expect(parseTtfbMetrics(TTFB_OUTPUT)).toEqual({
      ttfbRootRedirectColdMs: 142.7,
      ttfbRootRedirectWarmMs: 38.2,
      ttfbHomeColdMs: 311.4,
      ttfbHomeWarmMs: 96,
      ttfbDocsRootColdMs: 280.1,
      ttfbDocsRootWarmMs: 88.5,
    });
  });

  it("records no key for a route the measurement skipped", () => {
    expect(Object.keys(parseTtfbMetrics(TTFB_OUTPUT))).not.toContain("ttfbBlogEntryWarmMs");
  });

  it("keeps ttfb keys disjoint from the other keys they share a row with", () => {
    const recorded = [
      ...Object.keys(parseDeploySizeMetrics(DEPLOY_OUTPUT)),
      ...Object.keys(parseStartupProfileMetrics(STARTUP_OUTPUT)),
    ];
    const overlap = Object.keys(parseTtfbMetrics(TTFB_OUTPUT)).filter((key) =>
      recorded.includes(key)
    );

    expect(overlap).toEqual([]);
  });

  it("ignores ANSI colour codes", () => {
    const colored = "\u001b[32mTTFB target=home path=/en status=200 cold=10 ms warm=5 ms\u001b[0m";

    expect(parseTtfbMetrics(colored)).toEqual({ ttfbHomeColdMs: 10, ttfbHomeWarmMs: 5 });
  });

  it("throws when no route was measured", () => {
    expect(() => parseTtfbMetrics("TTFB base=https://example.test warmSamples=3")).toThrow(
      /TTFB measurements/
    );
  });
});
