# Cloudflare Workers Next.js SaaS Template - AI Assistant Guidelines

Production-ready Next.js SaaS template on Cloudflare Workers: authentication, multi-tenancy, billing, admin tools, email workflows. Stack: Next.js App Router and RSC on Vinext + Vite, TypeScript, Tailwind CSS, Shadcn UI / Base UI, Drizzle ORM, Cloudflare D1 / KV / R2 / Images, session auth modeled on Lucia (no Lucia package), Zustand, NUQS.

This file holds repo-specific rules only. `README.md` has setup and deployment. The reasons behind the rules are in `./docs/`. Before you work in an area, read its guide:

| Guide | Read before |
| --- | --- |
| [docs/api-and-mcp-internals.md](docs/api-and-mcp-internals.md) | Touching `src/api/`, `src/mcp/`, the OpenAPI document, or the `/docs/api` reference UI |
| [docs/extending-api-and-mcp.md](docs/extending-api-and-mcp.md) | Adding endpoints, scopes, or tools in a fork |
| [docs/database-and-migrations.md](docs/database-and-migrations.md) | Changing `src/db/schema.ts`, generating a migration, or merging upstream ones |
| [docs/i18n-and-locale-routing.md](docs/i18n-and-locale-routing.md) | Touching `src/i18n/`, `src/proxy.ts`, the root layout, or a route outside `app/[locale]/` |
| [docs/account-suspension-and-blocklist.md](docs/account-suspension-and-blocklist.md) | Touching the ban path, the registration blocklist, or a staff Stripe cancellation |
| [docs/worker-hot-path-and-bundle-size.md](docs/worker-hot-path-and-bundle-size.md) | Adding imports to the Worker entrypoint or another hot path |
| [docs/tracing.md](docs/tracing.md) | Adding a span, a span attribute, or an outcome value, or changing `src/utils/trace.ts` |
| [docs/edge-caching.md](docs/edge-caching.md) | Adding a `revalidate` or `dynamic` export to a page, or changing any `Cache-Control`, `Vary`, or `Cache-Tag` header the Worker sets |
| [docs/cursor-cloud-environment.md](docs/cursor-cloud-environment.md) | Running anything in Cursor Cloud: the default Node is too old, and plain `pnpm dev` hangs without Cloudflare auth |

## Scope

Deliver what was asked, at the scope intended. If a better approach exists, say so in one sentence and continue as asked. Add no file, abstraction, or option that the task does not need.

## Vinext and Checks

Vinext is Cloudflare's experimental Vite-based implementation of the Next.js API: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm run check:vinext`. GitHub Actions deploys; do not run `pnpm deploy`. Do not bring back `next dev`, `next build`, or OpenNext unless the user asks to migrate off Vinext.

Run the checks that match the change:

| Change | Run |
| --- | --- |
| Any code change | `pnpm run lint`, `pnpm run typecheck`, `pnpm run test:unit` |
| Routing, RSC or server actions, bindings, middleware, build config, deployment | Also `pnpm run check:vinext` and `pnpm run build` |
| Stripe webhooks, the scheduler, bindings, SQL conditions | Also `pnpm run test:integration` |
| User journeys, routing, auth | Also `pnpm run test:e2e` |
| Finished work, before you hand it back | `pnpx fallow audit` |

- When real D1/KV/Queue behavior matters more than a mock, write the test in `tests/integration/`.
- Fix an `anti-slop/*` lint finding; do not cast around it (`tools/oxlint/anti-slop/UPSTREAM.md` covers updates). Keep `oxlint` and `@oxlint/plugins` at the same exact version.
- Mark an intentional fire-and-forget promise with `void`. When a type is wrong about runtime behavior, disable the type-aware rule on that line and say why.
- Tests must pass in forks that change names, domains, branding, resource names, and flags. Derive expected values from constants, config, or payload structure, never from template-specific copy or URLs. When a flag can disable a feature, skip its test when off and cover the disabled fallback.

## Code Style

- Functional, declarative TypeScript; no classes. Named exports. Lowercase-with-dashes directories.
- Order a file as: exported component, subcomponents, helpers, static content, types.
- Always use braces, with the body on its own line. Oxlint's `curly --fix` writes `if (x) {return null;}` on one line; expand it.
- A function you define with more than one parameter takes one named object. Callbacks whose signature a library sets are exempt.
- Use `function` for pure functions. Prefer interfaces over types. Use const objects, not enums.
- Comment only non-trivial logic, edge cases, workarounds, and business rules: why, not what, in 3 lines or fewer. Delete a comment only when it is no longer true. Keep a TODO until the work is done and verified.
- Add `import "server-only"` to server-only modules, except `page.tsx`. Use `pnpm`.
- Do not edit `worker-configuration.d.ts`. Change `wrangler.jsonc` and run `pnpm run cf-typegen`.
- Put module-level tunables (batch sizes, TTLs, limits, prefixes, allowlists) at the top of the file. Put cross-cutting constants in `src/constants.ts`, `src/constants/`, or `src/app/enums.ts`; utilities in `src/utils/` or `src/lib/`; schemas in `src/schemas/`; cache tags and helpers in `src/utils/cache.ts`.

## One Rule, One Home

Before you write a helper, constant, type, or schema, search for one and reuse it. Keep a one-off pattern inline.

- A business rule (a liveness predicate, a cap, an ordering) is one named function or constant. A second copy — a hand-negated predicate, the same rule as raw SQL, a private chunk loop, a local batch size — is a bug.
- Split the rule from the I/O: a pure selector that returns a decision, and a thin caller that acts on it. Test the selector without mocks.
- A preview and the mutation it previews call the same selector. User-facing copy that describes a rule must match the predicate; pin the pair with a test.
- Read each store once per request. Do not list the same store twice on one path under two failure policies.
- A new cap or retention limit needs a sweep for rows that already exceed it, not only a write-path check.
- When a binding accepts an array, send one array, not one call per item.
- Order writes so a failure leaves a safe state, instead of adding a repair write. Run destructive cleanup after the durable write: save the new thing, then revoke what it replaces.
- A comment must not describe another module's behavior. Name the module instead.

## Frontend and Next.js

- Prefer server components. Use `use client` only for browser APIs or small interactive UI. Keep `useEffect` and local state to a minimum.
- Wrap a reusable server-side read (auth, session, config, database) in React `cache`. Never wrap mutations, server actions, route handlers, or reads that must change within one request.
- Give layout chrome with its own async data a small server wrapper behind a local `Suspense`. Make a whole layout async only when it must block for auth, redirects, or a route-wide decision.
- Use RSC for server state, Zustand only for real client state, and `nuqs` for URL state.
- Follow the existing Tailwind, Shadcn UI, and Base UI design system: responsive, mobile-first, light and dark. Pair `container` with `mx-auto`.

### Routing, Caching, and i18n

- `src/app/[locale]/layout.tsx` is the one root layout. Never create `app/layout.tsx`.
- Keep `dynamic = "force-dynamic"` on the root layout. No page exports `revalidate` or `dynamic = "force-static"`. Cache page data in KV through `setCacheScope`.
- Add a new static public page outside blog and docs to `STATIC_PUBLIC_ROUTES` in `src/constants/public-routes.ts`.
- Only machine endpoints live outside `app/[locale]/`; each needs its segment in `NON_LOCALIZED_PATH_SEGMENTS` (a test checks this).
- Only the writers named in `src/i18n/locale-cookie.ts` write the locale cookie. Call `resolveRequestLocale` and `localizedPathname`; do not re-derive a locale or a localized URL.
- Import i18n only from `@/i18n/client`, `@/i18n/server` (signed-in `(app)` routes and server actions), `@/i18n/translator` (public pages pass their `[locale]` param; also API, MCP, and shared lib code), and `@/i18n/navigation`. Take `Link`, `redirect`, and `useRouter` from `@/i18n/navigation`; use `next/navigation` only for non-localized targets, `notFound`, and refresh-only routers.
- Customer-facing copy, including emails and shared components in `src/components/`, goes through the catalogs with a row in every locale. `src/app/[locale]/(app)/(admin)/` is English-only staff tooling on purpose; do not translate it or report it.

## Authentication

- Server: `getCurrentSession` from `src/utils/auth.ts`. Client: `useSessionStore()` from `src/state/session.ts`.
- For browser tests of signed-in flows, use `test@test.com` / `password`.

## Public API, OAuth, and MCP

One declaration becomes a REST operation at `/api/v1`, an entry in `/docs/api`, and an MCP tool.

- Declare each route once with `...apiOperation({ ... })` from `src/api/operation.ts`, ahead of its validators. Validate with `apiValidator` or `teamIdParam` from `src/api/middleware/problem-json.ts`.
- Write the `description` for an agent: what the operation does, changes, and returns.
- Call the existing `src/lib/**` service; do not reimplement business rules in a handler.
- Type every response mapper as `v.InferOutput<typeof schema>`; nothing validates responses at runtime.
- `operationId`s and scope names are public contract. A rename renames a tool in configured clients.
- Do not translate machine responses. Throw `ActionError` with a stable code. A new code needs a `/docs/api/errors` row in every locale catalog. A refusal the caller can act on needs a row in `src/lib/api/error-details.ts`.
- Curate MCP tools with `MCP_TOOL_OVERRIDES`, `hiddenFromMcp()`, or `registerCustomTools`. Keep tool derivation and the document at build time.
- Do not add a spec-rendering dependency (Scalar, Swagger UI) for `/docs/api`.
- The API and MCP have no App Router request scope. Shared `src/lib/**` and `src/utils/**` code uses `getTranslator`, and `cookies()`/`headers()` throw there.
- App code never touches the `OAUTH_RESERVED_KV_PREFIXES` key space.
- When the public surface changes, update `src/lib/cms/build-llms-txt.ts` and `src/app/sitemap.ts`.
- The admin surface (`/api/admin/v1`, `/mcp/admin`) is a separate app, scope catalog, and document. Declare its routes with `...adminOperation({ ... })`. Never move an admin scope, route, or document into the public ones.

## Database and Migrations

- D1 has no transactions. For writes that must land together, use one `db.$client.batch([...])`.
- Do not pass `id` on insert or update. Do not write SQL migrations by hand; run `pnpm db:generate [MIGRATION_NAME]`.
- Add one new migration per commit unless a human permits more. Otherwise delete the incremental files, regenerate one migration, and reset the local dev DB.
- No database-level defaults (`.default(...)`, SQL `DEFAULT`), also on new tables; `$defaultFn()` is fine. New columns are nullable and unconstrained. Prefer `index()`/`uniqueIndex()` over `.unique()`. Treat `DROP COLUMN` and generated-column changes as destructive.
- **The tripwire:** after `pnpm db:generate`, read the full SQL and snapshot diff. `CREATE TABLE __new_*`, `INSERT INTO __new_* ... SELECT`, `DROP TABLE`, `PRAGMA foreign_keys=OFF`, or a `DROP COLUMN`/`ADD COLUMN` pair means a table rebuild. Stop, do not apply or deploy, and fix the drift. Never hand-edit those statements out or force them through with `PRAGMA legacy_alter_table` or `defer_foreign_keys`.

## Cloudflare

- Get bindings from `cloudflare:workers` in server-only code; use `getCloudflareContext` when you also need request `cf` metadata.
- Add a new environment variable to `.env.example` unless it is a public value in `wrangler.jsonc`. After you add a primitive to `wrangler.jsonc`, run `pnpm run cf-typegen`.
- Reuse the existing KV namespace.
- **Every KV `put` passes a TTL.** KV never evicts, so a key without one lives forever. Omit it only for a key space closed by code (a fixed set of names), and say so in a comment. A helper that writes for a caller takes the TTL as a required parameter.
- A TTL that paces work must outlive its interval (`PACED_RUN_TTL_INTERVALS` in `src/lib/scheduler/paced-run.ts`).
- On every upgrade of a third-party KV writer, including `@cloudflare/workers-oauth-provider` on `OAUTH_KV`, re-audit its key prefixes and TTLs.
- Queue messages carry IDs and small fields. The consumer loads the full record.
- Keep edge-only routing and header forwarding in `worker-entrypoint.ts`.
- Cloudflare MCP: query Turnstile and Images in separate `execute` calls. Together they can fail with `10000: Authentication error`.

## Async Work

- `Promise.all` independent consecutive awaits. Leave borderline cases sequential.
- Keep sequential: guards before what they guard, reads that must see an earlier write, D1 or cross-store writes, awaits split by an early return, and load-bearing error fall-through.
- Never `Promise.all` over an unbounded array; use `mapInBatches` from `src/utils/map-in-batches.ts`.
- Give each post-commit effect its own `.catch`, so it cannot fail the committed write (see `renameTeam` in `src/lib/teams/teams.ts`).

## Forms, Validation, and Server Actions

- Valibot schemas live in `src/schemas/` and import `v` and helpers from `src/lib/validation.ts`. Use one schema on client and server, and export its inferred type.
- **Every input string and array states a maximum.** Use the domain limit, the field rules in `src/schemas/fields.ts`, or the ceilings in `src/constants.ts`. `src/schemas/bounded-strings.test.ts` fails on an unbounded leaf; a new request schema in `src/schemas/api/` needs a line there.
- A user-facing validation message is a key, not English copy. Use the `src/lib/validation.ts` helpers, `validationKey`, or `encodeValidationMessage`, and add new keys to `Client.Validation` in every locale catalog.
- Server actions use `actionClient` from `src/lib/safe-action.ts` with `.inputSchema(schema)`. For authed actions, follow `src/app/[locale]/(app)/(settings)/settings/settings.actions.ts`; for ones that also purge CMS or KV caches, follow `src/app/[locale]/(app)/(admin)/admin/_actions/cms-media-actions.ts`.
- Client forms use `react-hook-form` with `valibotResolver`, `useAction` from `next-safe-action/hooks`, and toasts. Reference: `src/app/[locale]/(auth)/sign-up/`.
