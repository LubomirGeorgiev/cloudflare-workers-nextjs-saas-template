# Cloudflare Workers Next.js SaaS Template - AI Assistant Guidelines

Repo-specific rules only. Product overview, features, setup, and deployment live in `README.md`.

This file states the rules. The reasoning, file maps, and procedures behind them live in `./docs/` — read the relevant guide before working in that area:

| Guide | Read before |
| --- | --- |
| [docs/api-and-mcp-internals.md](docs/api-and-mcp-internals.md) | Touching `src/api/`, `src/mcp/`, the OpenAPI document, or the `/docs/api` reference UI |
| [docs/extending-api-and-mcp.md](docs/extending-api-and-mcp.md) | Adding endpoints, scopes, or tools in a fork |
| [docs/database-and-migrations.md](docs/database-and-migrations.md) | Changing `src/db/schema.ts`, generating a migration, or merging upstream ones |
| [docs/worker-hot-path-and-bundle-size.md](docs/worker-hot-path-and-bundle-size.md) | Adding imports to the Worker entrypoint or another hot path |
| [docs/page-caching.md](docs/page-caching.md) | Adding or changing `export const revalidate` on a public page, or touching how OpenGraph cards are cached |
| [docs/cursor-cloud-environment.md](docs/cursor-cloud-environment.md) | Running the app or the E2E suite in Cursor Cloud |

## Project Context

Production-ready Next.js SaaS template on Cloudflare Workers with Vinext and Vite. Core areas: authentication, multi-tenancy, billing, admin tools, email workflows.

Stack: Next.js App Router, React Server Components, TypeScript, Tailwind CSS, Vinext + Vite, Shadcn UI / Base UI, Drizzle ORM, Cloudflare Workers / D1 / KV / R2 / Images, Lucia Auth, Zustand, NUQS.

## Vinext

Cloudflare's experimental Vite-based implementation of the public Next.js API surface: App Router conventions, RSC, route handlers, server actions, and `next/*` imports all apply, but dev/build/start/deploy run through Vinext and Vite.

- `pnpm dev` — Vinext dev server
- `pnpm build` — build with Vinext and Vite
- `pnpm start` — local Vinext production server
- `pnpm run check:vinext` — Vinext compatibility scan

Never deploy manually (`pnpm deploy`); deployment is handled by GitHub Actions.

Do not reintroduce legacy `next dev`/`next build`/OpenNext commands unless explicitly asked to migrate off Vinext. Treat Vinext as experimental: for changes touching routing, RSC/server actions, Cloudflare bindings, middleware, build config, or deployment, run `pnpm run check:vinext`, `pnpm run typecheck`, and `pnpm run build` when feasible. References: https://vinext.io/ and https://github.com/cloudflare/vinext.

## General Coding Rules

- Concise, technical TypeScript. Functional and declarative patterns; avoid classes.
- Prefer iteration and modularization over duplication.
- Descriptive names (`isLoading`, `hasError`). Named exports. Lowercase-with-dashes directories.
- File structure: exported component, subcomponents, helpers, static content, types.
- Never delete comments unless they are no longer relevant.

### Control Flow

- Braces always, body on its own line. Oxlint's `curly` catches the missing braces but its `--fix` writes `if (x) {return null;}` on one line — expand it.

### Comments

Comment only non-trivial logic, edge cases, workarounds, and business rules — why, not what. Max 3 lines, to the point. Keep TODOs until the work is actually completed and verified.

### Functions and Types

- More than one parameter → pass a named object.
- Use the `function` keyword for pure functions.
- Prefer interfaces over types. Avoid enums; use maps or const objects.
- Never hand-edit the generated `worker-configuration.d.ts`; update `wrangler.jsonc` and run `pnpm run cf-typegen`.

### Constants

- Module-level tunables (batch sizes, TTLs, limits, prefixes, allowlists) go at the top of the file, after imports and any types they depend on — never buried mid-file next to their only caller.
- Global or cross-cutting configs belong in `src/constants.ts` (or `src/constants/` / `src/app/enums.ts` when that is the existing home). Keep a constant file-local only when it is truly private to that module.

### Imports and Packages

- Add `import "server-only"` to server-only modules, except `page.tsx`.
- Check `package.json` before adding a package. Use `pnpm` for all package management.

### Verification

- `pnpm run lint` (Oxlint), `pnpm run typecheck`, `pnpm run test:unit` (co-located `*.test.ts`).
- `pnpm run test:integration` — Workers-runtime behavior with local Miniflare D1/KV/Queue bindings; especially for subscription billing (Stripe webhooks), scheduler, Cloudflare bindings, and SQL-condition changes.
- `pnpm run test:e2e` — when changes could affect user journeys, routing, auth, or other integrated behavior.
- `pnpx fallow audit` when work is done, to audit the final changes before handing back.
- Run these after code changes when feasible, especially before handing work back.

### Template-Safe Tests

This repo is a template: tests must keep passing in downstream projects that customize names, domains, branding, Cloudflare resource names, feature flags, and environment constants.

- No hard-coded template-specific URLs, project/resource names, or branded copy in assertions unless the value is intentionally fixed by the template contract.
- Derive expected values from shared constants, configuration, generated fixtures, response payload structure, or invariant pathnames and behavior.
- Make tests flag-aware for features a template flag can disable: skip enabled-feature behavior when disabled and include focused no-op/fallback coverage for the disabled mode.

## DRY Rules

- Extract repeated values (especially validation limits) into constants, and repeated formatting/code paths into utilities.
- Reuse existing types, constants, helpers, and schemas before creating new ones.
- Centralize cache tags and shared cache helpers in `src/utils/cache.ts`.
- Prefer clear code over premature abstraction for simple one-off patterns.

Homes: constants → `src/constants.ts` or `src/app/enums.ts`; utilities → `src/utils/` or `src/lib/`; schemas → `src/schemas/`; shared types → same file or `src/types.ts`.

## Frontend and Next.js

- Prefer server components. Limit `use client`, `useEffect`, and local state; client components only for browser APIs or small interactive UI, wrapped in `Suspense` where appropriate.
- Use React.cache (`cache` from `react`) for reusable server-side read functions that may run multiple times in one RSC render/request — especially request-scoped auth/session/config/database reads. Never wrap mutations, server actions, route handlers, or functions whose result must change within the same request.
- Layout or shell chrome needing independent async server data: move it into a small server wrapper behind a local `Suspense` fallback. Only make an entire layout async when it must block for auth, redirects, request-scoped data, or decisions affecting the whole route.
- Use dynamic loading for non-critical UI when useful. Use `nuqs` for URL search-param state. Declarative JSX, concise conditionals.
- One root layout: `src/app/[locale]/layout.tsx`. It renders `RootShell` and `buildRootMetadata` from `src/utils/root-metadata.ts`, takes the locale from the URL segment, and is the only place an `<html>` element may appear. `app/layout.tsx` must never exist — a layout above `[locale]` cannot see the segment, so it would have to read request headers and no page could be cached. A second root would also make every crossing a full document load, tearing down the DOM and killing any toast raised just before it.
- The signed-in app lives under that root, in `src/app/[locale]/(app)/` — `(admin)`, `(dashboard)`, `(settings)`, and the OAuth consent page. Those routes are session-gated and therefore uncacheable anyway, so `getLocale`/`getTranslations` are allowed there and the `no-implicit-locale-translations` rule exempts the `(app)` subtree. Keep cacheable pages out of it.
- `src/proxy.ts` runs next-intl on every path `shouldLocalizePathname` accepts; its `config.matcher` only drops framework internals. Almost nothing belongs outside `app/[locale]/` now: only machine endpoints (`/api/*`, `/markdown/*`) do, and each needs its segment in `NON_LOCALIZED_PATH_SEGMENTS` in `src/i18n/localized-paths.ts` — `localized-paths.test.ts` walks `src/app/` and fails if you forget.
- Every page route is localized, so `redirect`, `Link`, and `useRouter` come from `@/i18n/navigation`, never from `next/navigation`. Only a target in `NON_LOCALIZED_PATH_SEGMENTS` uses plain `next/navigation` — a locale prefix on one of those 404s. `notFound` and a refresh-only `useRouter` are locale-agnostic and stay on `next/navigation`.
- `src/app/[locale]/(app)/(admin)/` is deliberately English-only: it is staff tooling, so literal copy there is the convention, not an oversight — do not "fix" it or open findings against it. Everything a customer can reach (marketing, auth, `(app)/(dashboard)`, `(app)/(settings)`, emails) must go through next-intl with a row in every locale catalog. Shared components used by both, like `src/components/data-table.tsx` and `src/components/ui/*`, follow the customer-facing rule.
- Tailwind, Shadcn UI, and Base UI, consistent with the existing design system. Responsive, mobile-first, light/dark mode. A `container` class always pairs with `mx-auto`.

## Authentication

Lucia Auth; logic lives in `src/utils/auth.ts` and `src/utils/kv-session.ts`.

- Server components: `getCurrentSession` from `src/utils/auth.ts`.
- Client components: `useSessionStore()` from `src/state/session.ts`.
- AI agents may use the test credentials `test@test.com` / `password` with browser automation to test authenticated flows.

## Public API, OAuth, and MCP

One pipeline, not four features: an endpoint described once becomes a documented operation, an entry in the server-rendered reference at `/docs/api`, and an MCP tool. Hono app in `src/api/` at `/api/v1`, spec at `/api/v1/openapi.json`, OAuth 2.1 provider wrapping the Worker in `worker-entrypoint.ts`, MCP server at `/mcp`. File map, error semantics, rate-limit headers, MCP derivation, KV key spaces, and the docs-UI internals: [docs/api-and-mcp-internals.md](docs/api-and-mcp-internals.md).

- Declare every route once, with `...apiOperation({ ... })` from `src/api/operation.ts` spread ahead of its validators: a unique `operationId`, `summary`, agent-readable `description`, `tags`, `scope`, `audience`, and success `responses`. From that one call come the `security` metadata, the shared `COMMON_ERROR_RESPONSES`, and the guard that enforces scope and audience before any validator runs.
- The `description` is what an agent sees as the tool description: what the operation does, changes, and returns — no marketing copy, no repo jargon.
- Never reimplement business rules in a handler. Mount on a router in `src/api/routes/` or via `registerCustomRoutes` in `src/api/index.ts`, validate with `apiValidator(target, schema)` (or `teamIdParam()`) from `src/api/middleware/problem-json.ts`, and call the existing `src/lib/**` service — server actions and the API share one code path.
- `audience` is `"account"`, `"team"` (addresses a `teamId` path parameter), or `"any"`. A route that declares no policy fails the route-table audit in `tests/integration/api-routes.test.ts`.
- Type every response mapper as `v.InferOutput<typeof schema>`; nothing validates responses at runtime, so that annotation is all that keeps the payload and the published document from drifting.
- `operationId`s and scope names are public contract — renaming one renames a tool in already-configured clients.
- Machine responses are i18n-exempt: throw `ActionError` with a stable code and never translate an API payload. A new error code or `FIELD_ERROR_CODES` entry needs a `/docs/api/errors` row in every locale catalog, and any refusal a caller can act on needs a row in `src/lib/api/error-details.ts` naming the limit and the way out.
- MCP tools are derived from the build-time document, never hand-written; curate with `MCP_TOOL_OVERRIDES`, `...hiddenFromMcp()`, or `registerCustomTools`. Never move derivation, or the document, back to runtime.
- The `/docs/api` reference is server-rendered from our own view model — never reintroduce a spec-rendering dependency (Scalar, Swagger UI, any multi-megabyte browser bundle).
- The API and MCP entrypoints are plain Worker handlers with no App Router request scope: in shared `src/lib/**` and `src/utils/**`, use `getTranslator` from `@/i18n/translator` rather than `getTranslations` from `next-intl/server`, and expect `cookies()`/`headers()` to throw.
- App code must never read or write the `OAUTH_RESERVED_KV_PREFIXES` key space (`src/constants/kv-prefixes.ts`); `src/lib/oauth/kv-prefixes.test.ts` enforces the split.
- A change to the public surface should also reach `src/lib/cms/build-docs-llms-txt.ts` and `src/app/sitemap.ts`.

## Database and Migrations

- Schema lives in `src/db/schema.ts`.
- Never use Drizzle transactions; Cloudflare D1 does not support them.
- Never pass `id` when inserting or updating with Drizzle; IDs are autogenerated in the schema.
- Never write SQL migration files manually. After schema changes, run `pnpm db:generate [MIGRATION_NAME]`.
- One new migration per commit, unless a human is explicitly asked and grants permission for more. Otherwise consolidate before committing: delete the incremental migration files, regenerate a single migration from the final schema, and reset/re-migrate local dev DB state so its journal matches.
- Never introduce database-level defaults — no Drizzle `.default(...)` / SQL `DEFAULT`, including on new tables; a runtime `$defaultFn()` is fine. New columns must be nullable and unconstrained. Prefer independent `index()`/`uniqueIndex()` over schema-level `.unique()`. Treat `DROP COLUMN` and generated-column changes as destructive.
- **The tripwire:** after `pnpm db:generate`, read the full generated SQL and snapshot diff. `CREATE TABLE __new_*`, `INSERT INTO __new_* ... SELECT`, `DROP TABLE`, `PRAGMA foreign_keys=OFF`, or a `DROP COLUMN`/`ADD COLUMN` replacement pair means a full table rebuild — stop, do not apply or deploy, and fix the drift that caused it. Never hand-edit those statements out, and never force one through with `PRAGMA legacy_alter_table` or `defer_foreign_keys`.

Why SQLite forces rebuilds and what they cost on D1, the approval path when one is unavoidable, and the procedure for merging upstream template migrations into a fork: [docs/database-and-migrations.md](docs/database-and-migrations.md).

## Cloudflare Rules

- Bindings come from `cloudflare:workers` in server-only code; use `getCloudflareContext` when code also needs forwarded request `cf` metadata.
- Workers integration tests live under `tests/integration/` (`vitest.integration.config.ts`); prefer them when real D1/KV/Queue behavior matters more than mocked unit tests.
- New environment variable → add to `.env.example` unless it is a public value hard-coded in `wrangler.jsonc`; add a short comment above it if its purpose is not 100% obvious.
- New Cloudflare primitive in `wrangler.jsonc` → run `pnpm run cf-typegen`.
- KV: always reuse the existing namespace in `wrangler.jsonc`; no new namespaces unless explicitly required.
- `OAUTH_KV` is a second binding onto that same namespace, because `@cloudflare/workers-oauth-provider` hardcodes the name. Re-audit the library's key usage (including its `list()` prefixes) on every upgrade, the same discipline as the drizzle-kit rule; the prefix ownership split is in [docs/api-and-mcp-internals.md](docs/api-and-mcp-internals.md).
- Queue messages have payload size limits: pass stable identifiers and small primitive fields, then load full records/blob content from D1, KV, R2, or other storage inside the consumer.
- The Worker entrypoint is `worker-entrypoint.ts`; keep edge-only routing and header forwarding there.
- Suggest Wrangler commands when relevant.

### Cloudflare MCP

Never bundle Turnstile (`/accounts/{account_id}/challenges/widgets`) and Images (`/accounts/{account_id}/images/v1/*`) API calls in the same `execute` invocation — query them in separate MCP calls. Bundled together they can fail the entire request with `10000: Authentication error`, even when other account endpoints work individually.

## State, Security, and Performance

- RSC for server state; Zustand only where client state is actually needed; NUQS for URL state.
- Preserve rate limiting, input validation, and sanitization patterns.
- Optimize for Web Vitals and efficient data fetching.

### Parallel Awaits

- `Promise.all` independent consecutive awaits; leave borderline cases sequential — a missed one costs nothing, a wrong one is a bug.
- Keep sequential: guards before what they guard, reads that must see an earlier write, D1/cross-store writes, awaits split by an early return, load-bearing error fall-through.
- Never `Promise.all(items.map(...))` over an unbounded array — chunk it, like `refreshTeamMemberSessions` in `src/utils/kv-session.ts`.
- Skip React `cache()` reads and repeated `getTranslations`/`cookies`/`headers` — already memoized.
- Post-commit effects that must not fail a committed write get their own `.catch` per entry (`renameTeam` in `src/lib/teams/teams.ts`).

## Forms, Validation, and Server Actions

### Schemas

- All Valibot schemas live in `src/schemas/`. Import `v` and shared validation helpers from `src/lib/validation.ts` — never Valibot directly in schema files.
- Reuse the same schema on client and server; do not duplicate validation between React Hook Form and server actions.
- Export both the schema and its inferred type.
- **Every input string and array states a maximum.** Without one the caller decides how much CPU, D1 row, and KV value budget a request spends. Use the domain limit if there is one, otherwise the shared field rules in `src/schemas/fields.ts` (`idField`, `tokenField`, `slugField`) or the ceilings in `src/constants.ts` (`ID_MAX_LENGTH`, `TOKEN_MAX_LENGTH`, `EMAIL_MAX_LENGTH`, ...). `emailString()` carries `EMAIL_MAX_LENGTH` itself; `trimmedString()` is the trim-then-bound helper for typed labels. `src/schemas/bounded-strings.test.ts` walks the real schema graph and fails on any unbounded leaf — `src/schemas/api/` *response* schemas are exempt, but a new *request* schema there needs a line in that test.

```typescript
import { emailString, minString, v } from "@/lib/validation";

export const mySchema = v.object({
  email: emailString(),
  password: minString(8),
});

export type MySchema = v.InferOutput<typeof mySchema>;
```

### Localized Validation Messages

- User-facing schema messages are stable validation keys, not inline English copy.
- Helpers from `src/lib/validation.ts` (`requiredString`, `emailString`, `minString`, `maxString`, `minMaxString`) emit localized `Validation.*` keys automatically.
- Custom messages: `validationKey("messageName")` or `encodeValidationMessage("messageName", params)` from `src/lib/validation.ts`; never hard-code the `Validation.` prefix in schemas.
- Add new validation keys to `Client.Validation` in every locale catalog under `src/i18n/messages/`.
- `FormMessage` and `actionClient` translate keyed messages via `translateValidationKey`; non-keyed inline messages pass through unchanged and must not be used for user-facing form validation.

### Server Actions

- All form-handling server actions use `actionClient` from `src/lib/safe-action.ts` with `.inputSchema(schema)`.
- Authenticated actions: follow `src/app/[locale]/(app)/(settings)/settings/settings.actions.ts` (`requireVerifiedEmail`, `withRateLimit`, `revalidatePath` cache invalidation).
- More complex authed actions that also invalidate CMS/KV caches: see `deleteCmsMediaAction`/`updateCmsMediaAction` in `src/app/[locale]/(app)/(admin)/admin/_actions/cms-media-actions.ts`.

### Client Forms

Use `react-hook-form` with `valibotResolver(schema)`, `useAction` from `next-safe-action/hooks` to call actions, and toast notifications for loading/success/error.

Reference implementation: action `src/app/[locale]/(auth)/sign-up/sign-up.actions.ts`, form `src/app/[locale]/(auth)/sign-up/sign-up.client.tsx`, schema `src/schemas/signup.schema.ts`.

## Cursor Cloud specific instructions

The build toolchain requires Node **>= 22.15**; the VM's default `/exec-daemon/node` is 22.14 and fails `pnpm build`/`pnpm dev`, so run `nvm use 24` if a shell resolves the wrong one. For offline dev use `CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm dev` — plain `pnpm dev` opens a Cloudflare remote proxy session and hangs without auth. Sign in with `test@test.com` / `password`.

Full caveats — remote bindings, Miniflare state and seeding, the IPv6 localhost gotcha, Turnstile, and the Playwright browser the E2E suite needs: [docs/cursor-cloud-environment.md](docs/cursor-cloud-environment.md).
