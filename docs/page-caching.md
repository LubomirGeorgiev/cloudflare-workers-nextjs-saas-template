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

## OpenGraph cards: one entry per pathname, never per query string

A card costs ~1.2 s of satori + resvg CPU to render. Cloudflare keys its cache on the full URL, but
the renderer never reads the search string — a metadata route handler gets only `params`. So
`/opengraph-image?<anything>` was the same PNG at an unbounded number of cache keys, and anyone could
bill us for unlimited renders by counting upwards.

The query vinext appends is a content hash of the route file, not the per-route dedup hash — that one
is in the pathname (`opengraph-image-v2by4x`, see `src/lib/og/og-paths.ts`). The hash covers the thin
route file only, never the shared renderer in `src/lib/og/translated-og-image.tsx` where the design
lives.

`worker-entrypoint.ts` therefore answers cards itself, before the OAuth provider and the app:
`serveOgImageFromCache` (`src/lib/og/og-cache.ts`) looks the card up in the colo cache under the
pathname alone. The key drops the query; the render keeps it, so a real page that wears a card's
segment still gets the answer for its own URL.

Four rules hold it together; keep them if you touch that file:

- **The key carries no headers.** The Cache API matches a response `Vary` against the key's headers.
  Nothing sets one today, but one header-free key on every lookup is what stops the entry from
  splitting back into one per crawler.
- **HEAD is rendered as GET.** Otherwise an attacker switches method and the enumeration is back.
- **Only a `200` with `image/png` is stored.** `/blog/opengraph-image-launch` may be a real post, and
  a 404 or a locale redirect must never occupy the slot the card needs.
- **A failed `cache.put` is swallowed.** Failing to warm the cache is not a reason to fail the crawl.

### Two caches are in play, and they are not the same cache

`wrangler.jsonc` sets `"cache": { "enabled": true }` — **Workers Caching**, which is what answers a
card with `cf-cache-status: HIT` today. Its key includes the path **and the query string**, which is
exactly why enumeration was free. `serveOgImageFromCache` uses the **Cache API** (`caches.default`),
which exists only inside the Worker and therefore sits behind it. They differ in ways that matter:

| | Workers Caching | Cache API (`caches.default`) |
| --- | --- | --- |
| Scope | The Worker, globally, tiered | The Worker, **one data center**, never tiered |
| Query string in the key | Yes, always | Only what we put there — we strip it |
| Worker version in the key | Yes by default, so **a deploy starts cold** | No, so **entries survive a deploy** |
| Runs the Worker on a hit | No — read-through | Yes, but only for the cache read |
| Collapses a concurrent burst | Yes | No |
| Purge | `ctx.cache.purge()` | `cache.delete` (local), or a zone Purge Everything |

Zone cache configuration — Cache Rules, Page Rules, cache level, the cached-file-extensions list —
has **no effect on either of these**. A Worker is zoneless; the cache follows the Worker. Do not
reach for a dashboard Cache Rule to fix a Worker caching problem.

### What this does not cover

The Cache API entry is per colo, so a card can still be rendered once per colo per TTL. The change
bounds render cost, not storage: Workers Caching still stores one body per enumerated query.

`localePrefix` is `"as-needed"` (`src/i18n/routing.ts`), so only the default locale's prefixed path
redirects. That card (`/en/opengraph-image?<n>`) is re-issued per query at a few ms each. Every other
locale serves a real PNG and gets its own entry, which `src/lib/og/og-cache.test.ts` asserts.

The entry holds no Worker version, so a deploy does not clear it. An edit to a route file used to
apply at once, through the new content hash in its query, and now waits for the TTL. A renderer or
CMS edit was always bounded by that same TTL.

The stronger shape, if these ever matter, is the gateway pattern: strip the query in a gateway
entrypoint and call a cached entrypoint through `ctx.exports` with `cf: { cacheKey: url.pathname }`.
That gets read-through, request collapsing, tiering, and version keying for free. It costs splitting
the Worker into two entrypoints, which is why the template does not do it yet.

## Adding a cacheable page

Put the literal above the default export with a one-line pointer, and add a row to the table above:

```ts
// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;
```
