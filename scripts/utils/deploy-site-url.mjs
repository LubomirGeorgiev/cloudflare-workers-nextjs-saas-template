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
