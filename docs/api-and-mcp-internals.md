# API, OAuth, and MCP internals

Where each piece of the public surface lives and why it is built this way. The rules an agent must
not break are in `AGENTS.md`; how a *fork* adds its own surface is in
[`extending-api-and-mcp.md`](extending-api-and-mcp.md).

One pipeline, not four features: an endpoint described once becomes a documented operation, an entry
in the server-rendered reference at `/docs/api`, and an MCP tool. Hono app in `src/api/` at
`/api/v1`, spec at `/api/v1/openapi.json`, OAuth 2.1 provider wrapping the Worker in
`worker-entrypoint.ts`, MCP server at `/mcp`.

## Where things live

| Concern | Home |
| --- | --- |
| Route declaration — scope, audience, and document metadata in one call | `src/api/operation.ts` |
| Scope catalog | `src/lib/api/scopes.ts` |
| Audience vocabulary and the `x-audience` extension | `src/lib/api/audience.ts` |
| `x-mcp` extension and `hiddenFromMcp()` | `src/lib/api/openapi-extensions.ts` |
| Principal and its AsyncLocalStorage | `src/lib/api/principal.ts` |
| RFC 9457 problem+json mapper | `src/lib/api/errors.ts` |
| Field-error vocabulary and Valibot-issue mapping | `src/lib/api/field-errors.ts` |
| Agent-readable prose for keyed `ActionError`s | `src/lib/api/error-details.ts` |
| Request and response schemas | `src/schemas/api/` |
| Generated OpenAPI document | `src/api/generated-document.ts` |
| RFC 9727 API catalog | `src/lib/api/api-catalog.ts` |
| Document generation | `scripts/generate-openapi.mjs` via the vite plugin `tools/openapi-document.ts` |
| Neutral document walking | `src/lib/api/openapi-walk.ts` |
| Docs view model | `src/lib/api/reference-model.ts` |
| MCP tool derivation and curation | `src/mcp/derive-tools.ts`, `src/mcp/tool-overrides.ts` |
| Agent-client registry | `src/constants/agent-clients.ts` |
| Endpoint paths and flags | `src/constants.ts` |
| Server-side OAuth lifecycle tuning | `src/constants/oauth.ts` |
| Both KV key-space registries | `src/constants/kv-prefixes.ts` |
| Rate-limit header formatting | `src/lib/api/rate-limit-headers.ts` |

The document is built once at build time and shared by the `openapi.json` route, the docs page, and
MCP. It is walked through `openapi-walk.ts` so the docs and MCP never import each other, and
`reference-model.ts` takes its operationId → tool-name map from its caller for the same reason.

## Discovery: `/.well-known/api-catalog`

RFC 9727. One RFC 9264 linkset with a context per published API — `/api/v1` and `/mcp` — naming the
OpenAPI document (`service-desc`), the human docs (`service-doc`, both the page and its `.md`
twin, each with its own media type), and the RFC 9728 protected resource metadata (`service-meta`)
of each. It is what an agent that knows only the origin reads
first, so it answers before any credential check, from the same edge fast path as `openapi.json`
in `worker-entrypoint.ts`, on `GET` and `HEAD` alone.

The document is built from constants in `src/lib/api/api-catalog.ts` and serialized once per
isolate. Its titles are untranslated on purpose: it is a machine response, and the edge has no
request scope to read a locale from. Every HTML response advertises it with a `rel="api-catalog"`
`Link` header, and `RootShell` renders the same relation as a `<link>` — the two channels llms.txt
already uses.

## Scope and audience: where the check goes

Three layers, on purpose — defense in depth for a public credential boundary, not accidental
duplication. Put a new check at the layer that owns the rule. Both only ever narrow a caller's live
permissions, never grant one, and a cookie session has no principal in scope and is unaffected by
either.

1. **Transport** (`apiOperation` → `policyGuard`): declares the operation's scope and audience,
   which both documents them and refuses early, ahead of every validator — a credential that may not
   call an operation at all must not learn its request schema from a 400.
2. **Team service chokepoint** (`requireTeamPermission` → `assertTeamAudience`): every team-scoped
   service re-asserts the audience, so a route that forgets to declare one still cannot act on a
   foreign team.
3. **Account-only services** (`createApiKey` → `assertAccountAudience`): services that mint
   credentials or perform other high-risk account operations re-assert account audience themselves,
   so reaching one past the transport layer changes nothing.

`audience` is `"account"`, `"team"` (addresses a `teamId` path parameter), or `"any"` — a
team-scoped API key (`teamId` set) is refused outside its team, and a route that declares no policy
fails the route-table audit in `tests/integration/api-route-policy.test.ts`. `policyGuard` asserts the
audience before the scope: a team key cannot hold an account-only scope, so a scope-first refusal
would send an agent after a grant it can never be given.

### The one unscoped operation

`GET /api/v1/credential` (`getCredential`) declares `scope: null`, the only operation that does. It
reports what the calling credential is — kind, audience, its team, and the scopes **in force** — so
a caller refused by a guard can find out what it actually holds instead of guessing from a 403. Gating it behind a scope would fail exactly the caller it exists for.

It reports the credential, never the account: `/me` answers "who owns this" and stays account-only,
so a team key cannot reach it. That split is what lets this route be unscoped without widening what
a team key can see. `team` is read off the audience the principal already carries, so the route
costs no D1 read and still names the team after the owner has lost the membership — the state that
makes such a key inert. It reports the team id alone, because `getTeam` and `listTeams` gate the
name and the slug behind `teams:read` and this route holds no scope at all. `team: null` therefore
means one thing only: the credential is personal.

`scope` is therefore `ApiScope | null` on `ApiOperationPolicy`. It stays required, so a forgotten
scope is a compile error, and `null` is a word you have to write. Three things keep that word from
becoming a loophole: `securityForScope()` still emits both security schemes (an empty scope list
demands a credential; *no* security would be public), `policyGuard` falls back to
`requirePrincipal()`, and two audits pin the exception. The route-table audit in
`tests/integration/api-route-policy.test.ts` fails unless the null-scope operations are exactly
`getCredential`, a GET with `audience: "any"`; `tests/integration/api-openapi-spec.test.ts` fails
any unscoped operation that is not a GET. A write whose grant nobody checked must never mount.

### Scopes a team key may not hold

A scope whose every operation declares `audience: "account"` is dead weight on a team key — the
audience guard refuses it whatever the scope says. `API_SCOPES` therefore flags each entry
`accountOnly`, and four places read it. `scopesForAudience` owns the narrowing rule itself:

- `createApiKey` and `updateApiKeyScopes` refuse the combination, so it is never written. The
  refusal lives there rather than in `createApiKeySchema` on purpose: a custom Valibot `check`
  reaches a machine caller as a bare `invalid_value` on `/scopes`, while the service names the
  offending scopes and the way out through `src/lib/api/error-details.ts`.
- `ScopePicker` offers a team key only the scopes `scopesForAudience` leaves, so the combination
  never arrives from the settings UI at all.
- `toPrincipal` in `src/utils/kv-api-key.ts` narrows, so a key issued before the rule existed
  resolves without those scopes rather than needing a migration.
- `toSummary` in `src/lib/api-keys/api-keys.ts` narrows every read of a key, so the settings page
  and `GET /api-keys` show the same grant the resolver enforces.

The flag is a denormalized copy of what the route table says, kept in the catalog so key creation
never has to import the OpenAPI document into a page bundle. Two tests in
`tests/integration/api-route-policy.test.ts` audit every flag against the mounted routes, so mounting a
team route under an account-only scope fails CI until the flag moves with it.

## Errors

Machine responses are i18n-exempt by design: throw `ActionError` with a stable code and let the
problem mapper emit `code` plus an untranslated `detail`. Localized copy stays in the message
catalogs; never translate an API payload. New codes need a row on `/docs/api/errors` in both
catalogs.

Validation failures answer with an `errors` array whose entries are `{ in, pointer, code, params? }`
— the OpenAPI parameter location, an RFC 6901 JSON Pointer, and a code from `FIELD_ERROR_CODES`.
Those codes are derived from the *shape* of the Valibot issue, never from a `Validation.*` catalog
key, so message copy stays free to change and a schema needs no per-field wiring to answer
correctly. Both vocabularies publish as enums in the document and as tables on `/docs/api/errors`,
so adding a code means a catalog row in every locale.

A keyed `ActionError` reaches an agent as prose only if its key has an entry in
`src/lib/api/error-details.ts`; without one it collapses to the generic sentence for its status
code. Any refusal a caller can act on — a limit hit, a bad argument, a missing permission — needs a
row there that names the limit and the way out.

## Rate limiting

Throttling reuses the app's KV limiter; there are no Cloudflare ratelimit bindings.
`RATE_LIMITS.API_AUTHED` (per credential) and `RATE_LIMITS.API_ANON` (per IP, charged only on failed
authentication) live in `src/utils/with-rate-limit.ts` and are applied by
`src/api/middleware/rate-limit.ts`.

Every response states the charged bucket with the `RateLimit-Limit` / `RateLimit-Remaining` /
`RateLimit-Reset` fields of draft-polli-ratelimit-headers-02, formatted in
`src/lib/api/rate-limit-headers.ts` — a 429 describes the bucket that refused it. Where the limiter
is bypassed (non-prod, `APP_TEST_MODE`) no headers are sent, rather than advertising a quota nothing
enforces.

## No request scope in the API and MCP entrypoints

Both are plain Worker handlers with no App Router request scope. In shared `src/lib/**` and
`src/utils/**` code, `getTranslations` from `next-intl/server` throws — use `getTranslator` from
`@/i18n/translator` — and `cookies()`/`headers()` throw unless an ALS-principal check short-circuits
first, as `getUserLocale` does. `src/lib/api/shared-service-imports.test.ts` guards the import half.

## MCP derivation

Tools are derived from the document, never hand-written. Curate with `MCP_TOOL_OVERRIDES` (rename,
re-describe, or hide by `operationId`), with `...hiddenFromMcp()` in a route's `apiOperation` to
hide it at the endpoint, or with `registerCustomTools` in `src/mcp/index.ts` for tools that have no
REST equivalent.

Derivation reads the build-time document and is memoized per isolate in `src/mcp/index.ts`, compiled
tool schemas included: the transport is stateless, so every JSON-RPC POST rebuilds the server and
re-registers every tool, and `fromJsonSchema` compiles a validator rather than wrapping the schema.
Never move that work, or the document, back to runtime — see
[`worker-hot-path-and-bundle-size.md`](worker-hot-path-and-bundle-size.md).

Dispatch stays in-process through `apiApp.fetch` inside `runWithPrincipal`; a Worker cannot fetch
its own URL (error 1042).

New or churning agent clients are a one-file edit in `src/constants/agent-clients.ts`. Snippets are
code and stay untranslated; only the chrome around them is localized.

## KV prefixes

Both registries live in `src/constants/kv-prefixes.ts`, and `APP_KV_PREFIXES` is the authoritative
list. App code owns `apikey:`, `oauthgrant:`, and `oauthgrant-gen:` alongside the pre-existing
`session:`, `rate-limit:`, `webauthn-challenge:`, `password-reset:`, `email-verification:`,
`md-page:`, and `vinext-cache*`.

`oauthgrant-gen:` holds one generation stamp per user. Every grant snapshot records the stamp it was
written under, so a purge invalidates all of that user's snapshots by writing one new stamp instead
of enumerating them. A read accepts the snapshot when the two stamps match, and also when no stamp
key exists at all, because the stamp outlives every snapshot written before it. API-key snapshots
get no stamp: their bearer path knows only the key hash, so it cannot build the per-user key without
a second round trip, and D1 supplies the user's key hashes instead.

The former `apikey-user:` and `oauthgrant-user:` index prefixes are gone. Their keys carried the
snapshot TTL (300 seconds or less — `API_KEY_CACHE_TTL_SECONDS` in `src/constants.ts` and
`OAUTH_GRANT_CACHE_TTL_SECONDS` in `src/constants/oauth.ts`), so any left in production self-expire
and no cleanup job is necessary.

`OAUTH_RESERVED_KV_PREFIXES` (`client:`, `grant:`, `token:`, `enterprise-jti:`) belongs to
`@cloudflare/workers-oauth-provider` — never read or write those from app code. `OAUTH_KV` is a
second binding onto the same namespace because the library hardcodes that name. The two sets must
stay disjoint; `src/lib/oauth/kv-prefixes.test.ts` enforces it, and the library's key usage
(including its `list()` prefixes) is re-audited on every upgrade.

## The reference UI at /docs/api

Ours, not a spec viewer: no Scalar, no Swagger UI, no multi-megabyte browser bundle, and no
spec-rendering dependency is to be reintroduced. `page.tsx` renders every operation on the server
from `buildApiReferenceView` (pure, in `src/lib/api/reference-model.ts`), and the only client
JavaScript is the filter island plus the copy buttons.

- Rendering pieces live in `src/app/[locale]/(marketing)/docs/api/_components/`. Field rows, JSON
  examples, and the `curl` snippet are all server-rendered; syntax coloring for examples is done
  while serializing, not by a highlighter.
- The client filter never re-renders the document: it hides nodes by the `data-api-*` attributes
  declared in `api-reference-dom.ts`, so the operations stay in the HTML for crawlers and for a
  no-JS reader. Both sides must keep using that one module.
- Presentation rules — nullable-union collapsing, nesting depth, example values, the shared error
  shape — belong in the view model with a unit test, not in JSX.

## Docs search over these pages

Docs search has two halves, merged by `searchDocs` in `src/lib/cms/cms-search.ts`. CMS entries come
from the FTS5 table `cms_entry_search`, which joins `cms_entry` and so can only ever hold CMS rows.
The pages above — and every operation inside `/docs/api` — are matched in memory instead, by
`src/lib/cms/docs-route-search.ts`.

- Route text is read from the locale catalog, not from JSX: `DOCS_ROUTE_MESSAGE_NAMESPACES` maps
  each `DocsRouteId` to its namespace under `Client.Docs`, and the index takes every string and
  nested content tree such as `ApiErrors.codes`. Adding a docs route means adding a line there
  (the record is total, so TypeScript asks); adding text to an existing page needs nothing.
- Operations are indexed from the build-time document by `operationId`, path, method, tags, and
  scope, and resolve to `${API_DOCS_PATH}#${operationAnchorId(operationId)}` — the same anchor the
  page renders, which is why that helper lives in `openapi-walk.ts` rather than being spelled twice.
- Both halves tokenize through `src/lib/cms/search-tokens.ts` so one query cannot mean two things.
  Route hits carry no bm25 score to blend with, so ordering is by match strength: a title or heading
  hit ranks above the CMS rows, a body-only hit below them.
- Route search does not depend on the CMS `enableSearch` flag — these pages exist in a fork that
  turns CMS search off.
- Unit tests resolve `virtual:api-openapi-document` to `tests/fixtures/api-openapi-document.ts`
  (aliased in `vitest.unit.config.ts`); the real document needs the vite plugin in `tools/`.

## Docs surfaces to keep in sync

`/docs/api`, `/docs/api/errors`, `/docs/authentication`, and `/docs/mcp` are app routes under
`src/app/[locale]/(marketing)/docs/`, not CMS documents — their chrome links live in
`docs-navigation-chrome.tsx` and `mobile-docs-nav.tsx`. The fork-extension guide is deliberately not
a route (it would get indexed on every deployed fork); it lives at
[`extending-api-and-mcp.md`](extending-api-and-mcp.md).

A change to the public surface should also be reflected in `src/lib/cms/build-llms-txt.ts` and
`src/app/sitemap.ts`. Migration discipline for `api_key` and `oauth_app` is unchanged: the same
no-DB-defaults, nullable-column, one-migration-per-PR rules as every other table.
