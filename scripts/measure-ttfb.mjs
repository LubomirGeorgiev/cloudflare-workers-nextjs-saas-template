// Needs Node >= 22.18, the first release that strips types without a flag; that is the `engines`
// floor in package.json. Node resolves neither the `@/` alias nor an extensionless path, so each
// module below is a leaf imported by relative path. Importing beats parsing source: a fork that
// renames a route base keeps measuring, and a rename that breaks this script fails loudly.
import { EDGE_HTML_CACHE_HEADER } from "../src/constants/edge-html-cache.ts";
import { BLOG_BASE_PATH } from "../src/lib/blog-routing.ts";
import { DOCS_BASE_PATH } from "../src/lib/cms/docs-config.ts";
import { parseWranglerConfig } from "./utils/parse-wrangler.mjs";

const SITEMAP_PATH = "/sitemap.xml";
const SITEMAP_LOC_PATTERN = /<loc>([^<]+)<\/loc>/g;
const WARM_SAMPLES = 3;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = "ttfb-baseline";
const NUMERIC_SEGMENT_PATTERN = /^\d+$/;

/** The deployed origin: an explicit argument, then the build variable, then the Worker route. */
function resolveBaseUrl() {
  const explicit = process.argv[2]?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const routes = parseWranglerConfig().routes ?? [];
  const pattern = routes
    .map((route) => (typeof route === "string" ? route : route?.pattern))
    .find((candidate) => typeof candidate === "string" && candidate.length > 0);

  if (!pattern) {
    return undefined;
  }

  return `https://${pattern.split("/")[0].replace(/^\*\./, "")}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Time to the first byte of the response: headers plus the first body chunk, when there is one.
 * A redirect has no body, so its reader finishes immediately and the header time stands.
 */
async function sampleTtfb(url) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const reader = response.body?.getReader();

  if (reader) {
    await reader.read();
    await reader.cancel();
  }

  return {
    ttfbMs: performance.now() - startedAt,
    status: response.status,
    cacheStatus: response.headers.get("cf-cache-status") ?? "",
    // Two layers answer a page: Workers Caching in front of the Worker, and the stored HTML copy
    // inside it. Printing both together is what tells a warm hit from a warm render.
    edgeHtmlCacheStatus: response.headers.get(EDGE_HTML_CACHE_HEADER) ?? "",
    location: response.headers.get("location") ?? "",
  };
}

function isRedirect(sample) {
  return sample.status >= 300 && sample.status < 400 && sample.location !== "";
}

// A section root may answer with a redirect to its first page. The number must time a render, so
// that one hop is followed; the root redirect target keeps its own hop, because that is the point.
async function measureTarget({ baseUrl, id, pathname, followRedirect = true }) {
  let url = `${baseUrl}${pathname}`;
  let cold = await sampleTtfb(url);

  if (followRedirect && isRedirect(cold)) {
    url = new URL(cold.location, baseUrl).href;
    pathname = new URL(url).pathname;
    cold = await sampleTtfb(url);
  }

  const warm = [];

  for (let index = 0; index < WARM_SAMPLES; index += 1) {
    warm.push((await sampleTtfb(url)).ttfbMs);
  }

  const result = {
    id,
    pathname,
    status: cold.status,
    coldMs: roundMs(cold.ttfbMs),
    warmMs: roundMs(median(warm)),
    cacheStatus: cold.cacheStatus,
    edgeHtmlCacheStatus: cold.edgeHtmlCacheStatus,
    location: cold.location,
  };

  console.log(
    `TTFB target=${result.id} path=${result.pathname} status=${result.status} ` +
      `cold=${result.coldMs} ms warm=${result.warmMs} ms ` +
      `cache=${result.cacheStatus || "-"}/${result.edgeHtmlCacheStatus || "-"}`
  );

  return result;
}

async function readSitemapPaths(baseUrl) {
  const response = await fetch(`${baseUrl}${SITEMAP_PATH}`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${SITEMAP_PATH} answered ${response.status}`);
  }

  const body = await response.text();

  return [...body.matchAll(SITEMAP_LOC_PATTERN)]
    .map((match) => {
      try {
        return new URL(match[1].trim()).pathname.replace(/\/$/, "");
      } catch {
        return "";
      }
    })
    .filter((pathname) => pathname.length > 0);
}

/**
 * A listing page is the prefix of other sitemap paths, so a leaf under the base is an entry.
 * Numeric last segments are pagination pages, not entries.
 */
function findEntryPath({ paths, basePath, exactDepth }) {
  const prefix = `${basePath}/`;

  return paths
    .filter((pathname) => pathname.startsWith(prefix))
    .filter(
      (pathname) =>
        exactDepth === undefined ||
        pathname.slice(prefix.length).split("/").length === exactDepth
    )
    .filter((pathname) => !NUMERIC_SEGMENT_PATTERN.test(pathname.split("/").pop()))
    .filter((pathname) => !paths.some((other) => other.startsWith(`${pathname}/`)))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function skip({ id, reason }) {
  console.log(`TTFB skipped target=${id} reason=${reason}`);
}

async function main() {
  const baseUrl = resolveBaseUrl();

  if (!baseUrl) {
    console.error(
      "No site URL. Pass one as the first argument, or set NEXT_PUBLIC_SITE_URL, or add a route to wrangler.jsonc."
    );
    process.exit(1);
  }

  console.log(`TTFB base=${baseUrl} warmSamples=${WARM_SAMPLES}`);

  const results = [
    await measureTarget({ baseUrl, id: "rootRedirect", pathname: "/", followRedirect: false }),
  ];
  // The locale prefix comes from the redirect itself, so it follows the deployed default locale.
  const localePrefix =
    results[0].location === ""
      ? ""
      : new URL(results[0].location, baseUrl).pathname.replace(/\/$/, "");

  let sitemapPaths = [];

  try {
    sitemapPaths = await readSitemapPaths(baseUrl);
  } catch (error) {
    console.log(`TTFB sitemap unavailable: ${error.message}`);
  }

  const targets = [{ id: "home", pathname: localePrefix === "" ? "/" : localePrefix }];

  targets.push({ id: "docsRoot", pathname: `${localePrefix}${DOCS_BASE_PATH}` });

  const docsEntry = findEntryPath({ paths: sitemapPaths, basePath: DOCS_BASE_PATH });

  if (docsEntry === undefined) {
    skip({ id: "docsEntry", reason: "no docs entry in the sitemap" });
  } else {
    targets.push({ id: "docsEntry", pathname: `${localePrefix}${docsEntry}` });
  }

  const blogEntry = findEntryPath({
    paths: sitemapPaths,
    basePath: BLOG_BASE_PATH,
    exactDepth: 1,
  });

  if (blogEntry === undefined) {
    skip({ id: "blogEntry", reason: "no blog entry in the sitemap" });
  } else {
    targets.push({ id: "blogEntry", pathname: `${localePrefix}${blogEntry}` });
  }

  for (const target of targets) {
    try {
      results.push(await measureTarget({ baseUrl, ...target }));
    } catch (error) {
      skip({ id: target.id, reason: error.message });
    }
  }

  console.log(
    `TTFB JSON: ${JSON.stringify({
      baseUrl,
      localePrefix,
      warmSamples: WARM_SAMPLES,
      targets: results.map((result) => ({
        id: result.id,
        pathname: result.pathname,
        status: result.status,
        coldMs: result.coldMs,
        warmMs: result.warmMs,
        cacheStatus: result.cacheStatus,
        edgeHtmlCacheStatus: result.edgeHtmlCacheStatus,
      })),
    })}`
  );
}

await main();
