import { afterEach, describe, expect, test, vi } from "vitest";

import { LOCAL_HOSTNAMES as SOURCE_OF_TRUTH } from "@/constants";
import {
  LOCAL_HOSTNAMES,
  findDeploySiteUrlProblem,
  resolveDeployedSiteUrl,
  resolveDeployZoneId,
  siteUrlFromWorkerRoutes,
} from "./deploy-site-url.mjs";
import { parseWranglerConfig } from "./parse-wrangler.mjs";

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

describe("resolveDeployedSiteUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("prefers the explicit value, then NEXT_PUBLIC_SITE_URL, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://configured.example.com/");

    expect(resolveDeployedSiteUrl("https://explicit.example.com/")).toBe("https://explicit.example.com");
    expect(resolveDeployedSiteUrl()).toBe("https://configured.example.com");
  });

  test("falls back to the first Worker route", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    expect(resolveDeployedSiteUrl()).toBe(siteUrlFromWorkerRoutes(parseWranglerConfig().routes ?? []));
  });

  test("reads the host of a custom domain, a zone route, and a wildcard route", () => {
    expect(siteUrlFromWorkerRoutes([{ pattern: "app.example.com", custom_domain: true }]))
      .toBe("https://app.example.com");
    expect(siteUrlFromWorkerRoutes(["app.example.com/*"])).toBe("https://app.example.com");
    expect(siteUrlFromWorkerRoutes([{ pattern: "*.example.com/*", zone_name: "example.com" }]))
      .toBe("https://example.com");
    expect(siteUrlFromWorkerRoutes([])).toBeUndefined();
  });
});

describe("resolveDeployZoneId", () => {
  const ACCOUNT_ID = "account-1";
  const SITE_URL = "https://app.example.com";

  function domainsResponse({ result, status = 200 }) {
    return vi.fn(async () => Response.json({ success: status === 200, result }, { status }));
  }

  test("uses the configured zone without a lookup", async () => {
    const fetchImpl = domainsResponse({ result: [] });

    await expect(resolveDeployZoneId({
      accountId: ACCOUNT_ID,
      apiToken: "token",
      configuredZoneId: " zone-override ",
      siteUrl: SITE_URL,
      fetchImpl,
    })).resolves.toEqual({ zoneId: "zone-override" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("finds the zone of the site hostname in the account's Workers domains", async () => {
    const fetchImpl = domainsResponse({ result: [{ hostname: "app.example.com", zone_id: "zone-1" }] });

    await expect(resolveDeployZoneId({
      accountId: ACCOUNT_ID,
      apiToken: "token",
      siteUrl: SITE_URL,
      fetchImpl,
    })).resolves.toEqual({ zoneId: "zone-1" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains?hostname=app.example.com`,
    );
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  test("reports no zone, without a lookup, for a deploy without a custom domain", async () => {
    const fetchImpl = domainsResponse({ result: [] });
    const noSiteUrl = await resolveDeployZoneId({ accountId: ACCOUNT_ID, apiToken: "token", fetchImpl });
    const workersDev = await resolveDeployZoneId({
      accountId: ACCOUNT_ID,
      apiToken: "token",
      siteUrl: "https://app.account.workers.dev",
      fetchImpl,
    });

    for (const result of [noSiteUrl, workersDev]) {
      expect(result.zoneId).toBeUndefined();
      expect(result.problem).toBeUndefined();
      expect(result.noZone).toBeTruthy();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("reports a problem for a custom domain whose zone it cannot find", async () => {
    const noDomain = await resolveDeployZoneId({
      accountId: ACCOUNT_ID,
      apiToken: "token",
      siteUrl: SITE_URL,
      fetchImpl: domainsResponse({ result: [] }),
    });
    const refused = await resolveDeployZoneId({
      accountId: ACCOUNT_ID,
      apiToken: "token",
      siteUrl: SITE_URL,
      fetchImpl: domainsResponse({ result: null, status: 403 }),
    });
    const noAccount = await resolveDeployZoneId({ apiToken: "token", siteUrl: SITE_URL });

    for (const result of [noDomain, refused, noAccount]) {
      expect(result.zoneId).toBeUndefined();
      expect(result.noZone).toBeUndefined();
    }
    expect(noDomain.problem).toContain("app.example.com");
    expect(refused.problem).toContain("403");
    expect(noAccount.problem).toContain("CLOUDFLARE_ACCOUNT_ID");
  });
});
