# Page caching: `export const revalidate`

Every public page opts into ISR with one number. The pages sit under `src/app/[locale]/(marketing)/`
and `src/app/[locale]/(legal)/`; each carries a one-line pointer comment back to this file.

Nothing under `src/app/[locale]/(app)/` is cached — those routes are session-gated, so they render per
request and must never export `revalidate`.

## What the timer is for on each page

A deploy starts an empty cache. So for text that only changes when we deploy, the timer buys nothing
on its own; it matters only for the live data on the page, or as a backstop.

| Pages | Value | What the timer actually bounds |
| --- | --- | --- |
| `(marketing)/page.tsx` | 3600 | How stale the GitHub star count can get. The page text changes only on deploy. |
| `docs/authentication`, `docs/mcp`, `docs/api`, `docs/api/errors` | 3600 | How stale the CMS-driven sidebar can get. The page text changes only on deploy. |
| `docs/[[...slug]]`, `blog`, `blog/[slug]`, `blog/authors`, `blog/authors/[authorId]`, `blog/tags`, `blog/tags/[slug]` | 3600 | Nothing, in the normal case. A CMS edit calls `revalidatePath` (`revalidateCmsEntryPaths` in `src/app/[locale]/(app)/(admin)/admin/_actions/cms-entry-revalidation.ts`) and clears these paths straight away, so readers see edits immediately. The hour is the backstop if that clearing fails. |
| `(legal)/privacy`, `(legal)/terms` | 86400 | Nothing. These change only on deploy, and there is no live data on them. |

## The value must be a numeric literal

Never write `export const revalidate = SOME_CONSTANT`, and never centralize the number itself. Vinext
reads this export twice, and only one of the two reads evaluates your code:

- **At runtime**, `resolveAppPageSegmentConfig` (`vinext/dist/server/app-segment-config.js`) reads the
  value off the imported module, so any expression works.
- **At build time**, `classifyAppRoute` (`vinext/dist/build/report.js`) parses the file and accepts
  only a number literal, `false`, `Infinity`, and a unary `+`/`-` on a literal. An identifier resolves
  to `null`, and the route drops from `isr` to `unknown`.

An `unknown` route loses its Nitro `swr` route rule (`vinext/dist/build/nitro-route-rules.js`, which
only emits a rule for `type === "isr"` with a finite positive number) and shows as unknown in the
build report. The page still revalidates at runtime, so the loss is silent.

Re-check this on a Vinext upgrade, the same as the other pinned-behavior audits.

## Adding a cacheable page

Put the literal above the default export with a one-line pointer, and add a row to the table above:

```ts
// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;
```

## Metadata routes do not get a timer

`sitemap.xml` and `robots.txt` are metadata routes, not pages, so `export const revalidate` does
nothing for them. Vinext gives every metadata route a fixed `public, max-age=0, must-revalidate` and
never routes it through the Cloudflare CDN adapter that gives pages their `CDN-Cache-Control`. Two
consequences follow from reading `vinext/dist/server/metadata-route-response.js`:

- The outer ISR cache there only turns on when the route's **default export** itself carries a
  `"use cache"` directive. Ours is a thin `await import()` wrapper, kept thin on purpose for the
  startup budget, so the cache never engages.
- Even with the directive, `@vinext/cloudflare`'s CDN adapter keeps no origin page store — its
  `get()` always returns null and its `set()` is a no-op — so the branch that emits a real
  `s-maxage` cannot run. The adapter caches by response header alone.

So the edge policy is stamped in `worker-entrypoint.ts` instead, from
`METADATA_ROUTE_EDGE_CACHE_CONTROL` and `EDGE_CACHED_METADATA_ROUTE_TAGS` in
`src/constants/cache-control.ts`. The sitemap also carries its `sitemap` cache tag, so a CMS publish
purges the edge copy through `revalidateCacheTag` and the hour is only a backstop.

Re-check this on a Vinext upgrade, the same as the other pinned-behavior audits: if a later version
runs metadata routes through the CDN adapter, the stamp becomes redundant.

## The edge cache is Workers Caching, not the Cache API

`wrangler.jsonc` turns on Cloudflare Workers Caching with `"cache": { "enabled": true }` (around line
25). The feature needs Wrangler 4.69.0 or above; this repo pins `^4.125.0` and compatibility date
`2026-08-03`.

Nothing in `src/` or `worker-entrypoint.ts` calls `caches.default` or `caches.open`. A grep for the
Cache API finds nothing, so a reader concludes that no edge cache runs. That conclusion is wrong: the
mechanism here is configuration, not code. Four independent code reviewers made that exact mistake,
which is why this section exists.

Workers Caching is also not the zone cache. Zone Cache Rules, Page Rules, and cache level settings do
not change it. The response headers the Worker sends are the whole configuration surface:

| Response header | What Workers Caching does |
| --- | --- |
| `cache-control: public, s-maxage=…` | Stores the response and serves it until the TTL ends. |
| `cache-control: no-store` or `private` | Does not store the response, and reports `Cf-Cache-Status: BYPASS`. It also drops the cache entry that already exists for that key. See the probe below. |
| `vary: accept` | Stores one variant per distinct value of the listed request header, per RFC 9110/9111. It compares those values verbatim, with no normalization. |
| `cache-tag: …` | Gives the purge identity. All variants of one URL must carry the same tags; different tags on different variants give inconsistent purges. |

This layer is not the Vinext CDN adapter of the section above. That adapter keeps no origin page
store, and it still keeps none. Both statements are true, and each one describes a different layer.

### Measured: an uncacheable response drops every variant

The docs say a `no-store` response is not stored. They do not say what happens to the entry that is
already there. We measured it on the deployed site, on `/docs/mcp`:

- **A — a cacheable variant miss evicts nothing.** Prime the browser `Accept` variant (HIT). Request
  with `Accept: application/x-test` (MISS, then HIT). Return to the browser `Accept`: still **HIT**.
  Two variants coexist, and both stay alive.
- **B — an uncacheable response kills both.** Request with `Accept: text/markdown`, which returned a
  `no-store` 303 (`cf-cache-status: BYPASS`). The browser `Accept` variant is then **MISS**, and the
  `x-test` variant is **MISS** too.

So the whole entry goes, and every `vary: accept` variant goes with it. One request cold-flushed the
page HTML for every visitor in that data center. Anyone could do it, with no auth and one header.

That is why `MARKDOWN_NEGOTIATION_CACHE_CONTROL` in `src/constants/cache-control.ts` is
`public, max-age=0, s-maxage=…` and not `no-store`. A stored 303 becomes its own variant beside the
HTML instead of an invalidation of it. `max-age=0` keeps it out of private browser caches, so a
client that once asked for Markdown does not keep redirecting itself.

The safety argument is that the cache key partitions more finely than the branch it feeds. The
variant key is the exact `Accept` string, and `prefersMarkdownRepresentation` reads that same string.
Two requests that share a variant key therefore always get the same answer from the Worker, so a
stored 303 only ever reaches a caller who would have received that 303 live. A browser `Accept`
string never names `text/markdown`, so it never matches that variant.

### Known gaps, both bounded

- **Purge skew.** A rendered page carries a `cache-tag` (`src/lib/markdown-pages/serve-page.ts:162`
  reads one back off a render), and the edge builds the 303 before any render, so the 303 variant
  carries no tag. A tag purge may leave it behind. The redirect target is a pure function of the
  pathname, so a CMS publish can never make a stale 303 wrong. Only removing a page from the Markdown
  allowlist could, and then the agent gets a 404 from the `.md` — never wrong content — for at most
  the TTL.
- **Variant fan-out.** `withHtmlDiscoveryLinkHeader` (`src/lib/markdown-pages/discovery-links.ts`)
  puts `vary: accept` on every HTML page that has a `.md` twin, so the edge splits per exact `Accept`
  string. Chrome, Firefox, and Safari each send a different one, and the strings change between
  versions. This predates the negotiation change. Cloudflare's remedy is to normalize `Accept` before
  the cached entrypoint sees it.

### Still to confirm after the next deploy

Re-run the A/B probe and read `cf-cache-status` on the 303. `HIT` is the intended result. `EXPIRED`
or `REVALIDATED` means `max-age=0` won over `s-maxage` — still stored, so the eviction is still
fixed; drop `max-age=0` to get the hits. `BYPASS` means Cloudflare declines to store a 303: no
regression, but the eviction stays, and the fallback is to disable Workers Caching on the entrypoint
and move page caching to an inner entrypoint.

Re-check this on a Wrangler or Vinext upgrade, the same as the other pinned-behavior audits.
