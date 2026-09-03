import { describe, expect, test } from "vitest";

import { LOCAL_HOSTNAMES as SOURCE_OF_TRUTH } from "@/constants";
import { LOCAL_HOSTNAMES, findDeploySiteUrlProblem } from "./deploy-site-url.mjs";

describe("deploy site URL guard", () => {
  // The guard is only as good as its list: a hostname the app treats as local but the guard does
  // not would ship local mode to production, which is the exact state this guard exists to stop.
  test("matches the local hostnames the app itself uses", () => {
    expect([...LOCAL_HOSTNAMES].sort()).toEqual([...SOURCE_OF_TRUTH].sort());
  });

  test("allows an unset value, so the production fallback still applies", () => {
    expect(findDeploySiteUrlProblem(undefined)).toBeUndefined();
    expect(findDeploySiteUrlProblem("  ")).toBeUndefined();
  });

  test("allows a public site URL", () => {
    expect(findDeploySiteUrlProblem("https://example.com")).toBeUndefined();
  });

  test("rejects every local origin, on any port", () => {
    for (const hostname of SOURCE_OF_TRUTH) {
      expect(findDeploySiteUrlProblem(`http://${hostname}:8787`)).toContain("local origin");
    }
  });

  test("rejects a value that is not a URL", () => {
    expect(findDeploySiteUrlProblem("nextjs-saas-template.example.com")).toContain("not a valid URL");
  });
});
