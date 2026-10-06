# i18n and locale routing

The rules are in `AGENTS.md`. This page gives the reasons behind them. The module map and the
steps to add a locale are in the "Internationalization (i18n)" section of `README.md`.

The repo owns its i18n layer. `use-intl` supplies only the ICU translator and the React hooks.
Everything else — the locale routing, the middleware, and the server API — lives in `src/i18n/`.

## One root layout

`src/app/[locale]/layout.tsx` is the only root layout. It renders `RootShell`, builds metadata with
`buildRootMetadata` from `src/utils/root-metadata.ts`, and takes the locale from the URL segment.

`app/layout.tsx` must never exist, for two reasons:

- A layout above `[locale]` cannot see the segment, so it cannot set `<html lang>` from the URL.
- A second root layout makes every crossing between the two roots a full document load. That
  tears down the DOM and removes any toast raised just before the navigation.

## Signed-in and public pages

The signed-in app lives under `src/app/[locale]/(app)/`: `(admin)`, `(dashboard)`, `(settings)`,
and the OAuth consent page. Those routes are session-gated and never edge-cached, so they may call
`getLocale`/`getTranslations` from `@/i18n/server`.

A public page takes the locale from its `[locale]` param and passes it to `getTranslator` from
`@/i18n/translator`. The same function works in the API and MCP handlers, which have no App Router
request scope.

## The locale route

`src/proxy.ts` is a thin adapter over `decideLocaleRoute` in `src/i18n/middleware.ts`. That
function is pure and holds the whole locale route. The proxy runs on every path that
`shouldLocalizePathname` accepts. Its `config.matcher` drops only framework internals.

The order of signals is: the URL prefix, then the locale cookie, then `Accept-Language`, then the
default locale. The default locale is served at the bare path (`/blog`), and every other locale is
prefixed (`/es/blog`).

One URL keeps the default prefix: a card (`opengraph-image`). Vinext builds the `og:image` URL from
the internal `app/[locale]/` path, so a default-locale page names `/en/.../opengraph-image`. A
redirect there would cost every crawler one hop. `isDefaultLocaleCardPathname` in
`src/i18n/locale-prefix.ts` holds the rule. `decideLocaleRoute` serves the card in place, and
`collapseDisabledLocalePrefix` lets it pass.

`resolveRequestLocale` in `src/i18n/resolve-locale.ts` is the one answer to "what locale is this
request". The edge HTML cache calls the same function as the proxy, so the two cannot drift. See
"The gate" in [edge-caching.md](edge-caching.md).

A rule that the edge can decide from the URL alone lives in `worker-entrypoint.ts`, not in the
proxy. The one such rule today: with i18n disabled, `collapseDisabledLocalePrefix` redirects a
locale-prefixed URL to its bare path.

## The locale cookie

The cookie records an explicit choice of locale, so only an explicit choice writes it.
`src/i18n/locale-cookie.ts` names the writers. The proxy and the edge HTML cache only read it.

There is a second reason the proxy writes no cookie. Vinext pins any response that carries a
`Set-Cookie` from middleware to `no-store, must-revalidate`. That overwrites the `Cache-Control`
that the route set, which breaks the edge-cached routes in [edge-caching.md](edge-caching.md).

## Routes outside `app/[locale]/`

Only machine endpoints live outside `app/[locale]/`: `/api/*`, `/markdown/*`, and `/llms.txt`.
Each needs its segment in `NON_LOCALIZED_PATH_SEGMENTS` in `src/i18n/localized-paths.ts`.
Otherwise the proxy rewrites the path to a locale route, and the rewrite returns 404.
`localized-paths.test.ts` walks `src/app/` and fails when a segment is missing.

Two cases need no entry. A path with a dotted segment (`/robots.txt`, `/docs/llms.txt`) is never
localized. `docs` serves both localized pages and root-level routes, so it is in
`MIXED_LOCALIZATION_PATH_SEGMENTS` instead, and the dotted-segment rule separates the two halves.
Paths that a Worker handler answers first (`/mcp`, `/api/v1`) never reach the proxy.

## Import homes

Four modules are the only i18n imports outside `src/i18n/`:

| Import | Use |
| --- | --- |
| `@/i18n/client` | Client hooks (`useTranslations`, `useLocale`, `useFormatter`) |
| `@/i18n/server` | `getLocale`/`getTranslations` inside an App Router request |
| `@/i18n/translator` | `getTranslator` everywhere else: public pages, `src/lib/**`, `src/utils/**`, API, MCP |
| `@/i18n/navigation` | `Link`, `redirect`, `useRouter`, `getPathname` |

Outside `src/i18n/`, only a catalog *type* may come from `use-intl/core` directly. A translator or
a hook must come from one of the four modules above.

`localizedPathname` in `src/i18n/localized-pathname.ts` is the one answer to "which URL serves
this path in this locale". The middleware, the navigation surface, the edge cache, and the sitemap
all call it.

## Navigation

Every page route is localized, so `redirect`, `Link`, and `useRouter` come from
`@/i18n/navigation`. Those versions add the locale prefix that the target needs.

Plain `next/navigation` is correct in three cases:

- The target is in `NON_LOCALIZED_PATH_SEGMENTS`. A locale prefix on one of those paths returns 404.
- `notFound`, which does not depend on the locale.
- A `useRouter` that only calls `refresh()`.

## Which copy is translated

Everything a customer can reach goes through `@/i18n/client` or `@/i18n/server`, with a row in
every locale catalog: marketing, auth, `(app)/(dashboard)`, `(app)/(settings)`, and emails. Shared
components that both staff and customers use, such as `src/components/data-table.tsx` and
`src/components/ui/*`, follow the same rule.

`src/app/[locale]/(app)/(admin)/` is English-only. It is staff tooling, so literal copy there is
the convention, not an oversight. The ban notice email is a second documented exception; see
"The two reasons" in [account-suspension-and-blocklist.md](account-suspension-and-blocklist.md).
