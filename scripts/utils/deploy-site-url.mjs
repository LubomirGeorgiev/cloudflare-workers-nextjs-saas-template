import { parseWranglerConfig } from "./parse-wrangler.mjs";

// A copy of LOCAL_HOSTNAMES from src/constants.ts, because this runs in plain Node at deploy
// time and cannot import TypeScript. deploy-site-url.test.mjs fails when the two drift.
export const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Report why NEXT_PUBLIC_SITE_URL must not ship, or undefined when it is safe to deploy.
 * An unset value is safe: SITE_URL then falls back to the production domain.
 */
export function findDeploySiteUrlProblem(siteUrl) {
  const trimmed = siteUrl?.trim();

  if (!trimmed) {
    return undefined;
  }

  let hostname;

  try {
    hostname = new URL(trimmed).hostname;
  } catch {
    return `NEXT_PUBLIC_SITE_URL is not a valid URL: ${trimmed}`;
  }

  if (!LOCAL_HOSTNAMES.includes(hostname)) {
    return undefined;
  }

  // `isLocalhost` reads this same value, so shipping it would disable rate limiting, drop the
  // session cookie to sameSite=lax, and stop every transactional email.
  return [
    `NEXT_PUBLIC_SITE_URL points at a local origin: ${trimmed}`,
    "A deployed build must not use one. It turns on local mode, which disables rate limiting,",
    "relaxes the session cookie sameSite policy, and stops all transactional email.",
    "Unset the variable to use the production fallback, or set it to the public site URL.",
  ].join("\n");
}

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const WORKERS_DEV_HOSTNAME_SUFFIX = ".workers.dev";

/** The deployed origin: an explicit value, then NEXT_PUBLIC_SITE_URL, then the Worker route. */
export function resolveDeployedSiteUrl(explicit) {
  const configured = explicit?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return siteUrlFromWorkerRoutes(parseWranglerConfig().routes ?? []);
}

/** The origin of the first Worker route in `wrangler.jsonc`, or undefined when it has none. */
export function siteUrlFromWorkerRoutes(routes) {
  const pattern = routes
    .map((route) => (typeof route === "string" ? route : route?.pattern))
    .find((candidate) => typeof candidate === "string" && candidate.length > 0);

  if (!pattern) {
    return undefined;
  }

  return `https://${pattern.split("/")[0].replace(/^\*\./, "")}`;
}

/**
 * The zone the deploy purges: the configured override, else the zone of the site hostname, found
 * the way `getWorkerZoneId` in src/lib/cloudflare-api.ts finds it. Never throws. `noZone` means a
 * workers.dev-only deploy with nothing to purge; `problem` means a custom domain whose zone is unknown.
 */
export async function resolveDeployZoneId({
  accountId,
  apiToken,
  configuredZoneId,
  siteUrl,
  fetchImpl = fetch,
}) {
  const override = configuredZoneId?.trim();

  if (override) {
    return { zoneId: override };
  }

  const hostname = customDomainHostname(siteUrl);

  if (!hostname) {
    return { noZone: "The deploy has no custom domain, so there is no zone to purge." };
  }

  return lookupWorkerZoneId({ accountId: accountId?.trim(), apiToken, hostname, fetchImpl });
}

function customDomainHostname(siteUrl) {
  const hostname = siteUrl ? new URL(siteUrl).hostname : undefined;

  return hostname?.endsWith(WORKERS_DEV_HOSTNAME_SUFFIX) ? undefined : hostname;
}

async function lookupWorkerZoneId({ accountId, apiToken, hostname, fetchImpl }) {
  if (!accountId) {
    return { problem: `CLOUDFLARE_ACCOUNT_ID is required to find the zone of ${hostname}.` };
  }

  const response = await fetchImpl(
    `${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );

  if (!response.ok) {
    return { problem: `The zone lookup for ${hostname} failed with HTTP ${response.status}.` };
  }

  const zoneId = zoneIdFromWorkersDomains(await response.json().catch(() => ({})));

  return zoneId
    ? { zoneId }
    : { problem: `No Workers custom domain in this account matches ${hostname}.` };
}

function zoneIdFromWorkersDomains(body) {
  const domains = Array.isArray(body?.result) ? body.result : [];

  return domains.find((domain) => domain.zone_id)?.zone_id;
}
