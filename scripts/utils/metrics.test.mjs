import { describe, expect, it } from "vitest";

import { parseDeploySizeMetrics, parseStartupProfileMetrics, toBytes } from "./metrics.mjs";

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
