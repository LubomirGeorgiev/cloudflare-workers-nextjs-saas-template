# Cloudflare Workers Next.js SaaS Template - AI Assistant Guidelines

Repo-specific rules only. Product overview, features, setup, and deployment live in `README.md`.

## Project Context

Production-ready Next.js SaaS template on Cloudflare Workers with Vinext and Vite. Core areas: authentication, multi-tenancy, billing, admin tools, email workflows.

Stack: Next.js App Router, React Server Components, TypeScript, Tailwind CSS, Vinext + Vite, Shadcn UI / Base UI, Drizzle ORM, Cloudflare Workers / D1 / KV / R2 / Images, Lucia Auth, Zustand, NUQS.

## Vinext

Vinext is Cloudflare's experimental Vite-based implementation of the public Next.js API surface. The usual App Router conventions, RSC, route handlers, server actions, and `next/*` imports all apply, but dev/build/start/deploy run through Vinext and Vite:

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
- `src/proxy.ts` runs next-intl on all paths except an exclusion list of non-public routes. When adding a new top-level non-public/authed section outside `app/[locale]/` (like `/dashboard`), add its segment to that matcher; public pages need no change.
- Tailwind, Shadcn UI, and Base UI, consistent with the existing design system. Responsive, mobile-first, light/dark mode. A `container` class always pairs with `mx-auto`.

## Authentication

Lucia Auth; logic lives in `src/utils/auth.ts` and `src/utils/kv-session.ts`.

- Server components: `getSessionFromCookie` from `src/utils/auth.ts`.
- Client components: `useSessionStore()` from `src/state/session.ts`.
- AI agents may use the test credentials `test@test.com` / `password` with browser automation to test authenticated flows.

## Database and Migrations

- Schema lives in `src/db/schema.ts`.
- Never use Drizzle transactions; Cloudflare D1 does not support them.
- Never pass `id` when inserting or updating with Drizzle; IDs are autogenerated in the schema.
- Never write SQL migration files manually. After schema changes, run `pnpm db:generate [MIGRATION_NAME]`.
- A commit must NEVER contain multiple new migrations unless a human is explicitly asked and gives permission. Without it, consolidate before committing: delete the incremental migration files, regenerate a single migration from the final schema, and reset/re-migrate local dev DB state so its journal matches. This covers migrations you authored; migrations from an upstream template merge follow "Merging Template Migrations Into a Fork" below.

### D1/SQLite Schema-Change Safety

Mental model: SQLite can only alter a table in place for a tiny whitelist of operations — rename a table, rename a column, add a nullable unconstrained column, create/drop independent indexes/triggers/views. Almost any other change to an existing table (types, nullability, defaults, PKs, unique/check constraints, FKs, `STORED` generated columns, dropping columns) makes `drizzle-kit` emit a full replacement-table migration: create `__new_*` table, copy every row, drop the old table, rename. On D1 that rebuild is dangerous — FK enforcement stays active during migrations (`DROP TABLE` can fire `ON DELETE` cascades; the generated `PRAGMA foreign_keys=OFF` does not help), and the single `INSERT ... SELECT` copy can blow D1's 30-second query limit.

Rules that follow from this:

- Never introduce database-level defaults: no Drizzle `.default(...)` / SQL `DEFAULT`, including on new tables. Supply values on every insert; a runtime `$defaultFn()` is fine. Don't remove an existing production default just to comply — that itself rebuilds the table.
- Prefer independent `index()`/`uniqueIndex()` over schema-level `.unique()` unless the key is a primary/FK invariant: index changes only touch the index; constraint changes rebuild the table.
- New columns must be nullable and unconstrained (no `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, or `STORED` on a populated table). Treat `DROP COLUMN` and generated-column changes as destructive; check dependent indexes, constraints, triggers, and views first.
- The tripwire: after `pnpm db:generate`, read the full generated SQL and snapshot diff. If it contains `CREATE TABLE __new_*`, `INSERT INTO __new_* ... SELECT`, `DROP TABLE`, `PRAGMA foreign_keys=OFF`, or a `DROP COLUMN`/`ADD COLUMN` replacement pair — stop, do not apply or deploy. Find the schema/snapshot/history drift that caused it, fix the source, and regenerate. Never hand-edit rebuild statements out of a generated migration, and never use `PRAGMA legacy_alter_table` or `defer_foreign_keys` to force one through.
- Keep migrations pure schema: batch large data backfills separately, and no `VACUUM`/`REINDEX` (use `PRAGMA optimize` if maintenance is needed).
- If a production rebuild is genuinely unavoidable, get explicit user approval first, with a documented backup/Time Travel recovery point and rollback plan.
- Re-audit this behavior whenever `drizzle-kit` is upgraded. References: [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

### Merging Template Migrations Into a Fork

Each `snapshot.json` records the whole schema, so an upstream migration arrives describing a database without the fork's tables; merged as-is it truncates the lineage and the next `pnpm db:generate` recreates existing tables.

- Keep the incoming `migration.sql` and directory names untouched. Fix the merge by rebasing only `snapshot.json`: replay each migration's entity delta onto the fork's newest snapshot, oldest-first, and re-point `prevIds` while keeping the upstream `id` values.
- Take the delta baseline from the template ref, never the fork's same-id snapshot; they differ in content and getting it wrong fails silently.
- Done when `drizzle-kit check` and `pnpm db:generate` report no drift and `pnpm run test:e2e` replays the chain. If the upstream SQL assumes a schema the fork lacks, consolidate into one regenerated migration instead and re-add its data statements.

## Cloudflare Rules

- Bindings come from `cloudflare:workers` in server-only code; use `getCloudflareContext` when code also needs forwarded request `cf` metadata.
- Workers integration tests live under `tests/integration/` (`vitest.integration.config.ts`); prefer them when real D1/KV/Queue behavior matters more than mocked unit tests.
- New environment variable → add to `.env.example` unless it is a public value hard-coded in `wrangler.jsonc`; add a short comment above it if its purpose is not 100% obvious.
- New Cloudflare primitive in `wrangler.jsonc` → run `pnpm run cf-typegen`.
- KV: always reuse the existing namespace in `wrangler.jsonc`; no new namespaces unless explicitly required.
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
- Authenticated actions: follow `src/app/(settings)/settings/settings.actions.ts` (`requireVerifiedEmail`, `withRateLimit`, `revalidatePath` cache invalidation).
- More complex authed actions that also invalidate CMS/KV caches: see `deleteCmsMediaAction`/`updateCmsMediaAction` in `src/app/(admin)/admin/_actions/cms-media-actions.ts`.

### Client Forms

Use `react-hook-form` with `valibotResolver(schema)`, `useAction` from `next-safe-action/hooks` to call actions, and toast notifications for loading/success/error.

Reference implementation: action `src/app/(auth)/sign-up/sign-up.actions.ts`, form `src/app/(auth)/sign-up/sign-up.client.tsx`, schema `src/schemas/signup.schema.ts`.

## Cursor Cloud specific instructions

Standard install, DB, test, lint, build, and run commands are in `README.md` and `package.json`. Below are only the non-obvious caveats for this environment.

### Node version (critical)

- The build toolchain (`@cloudflare/vite-plugin` → `vinext build`/`pnpm build`) requires Node **>= 22.15** (`node:module`'s `registerHooks`). The VM's default `/exec-daemon/node` is 22.14 and fails `pnpm build`/`pnpm dev` with `SyntaxError: ... does not provide an export named 'registerHooks'`.
- Node 24 is the nvm default (`nvm alias default 24`) and `~/.bashrc` prepends it ahead of `/exec-daemon`, so new shells should already run Node 24 with `pnpm` available. If a shell resolves the wrong Node: `nvm use 24` or re-source `~/.bashrc`.

### Running the app locally

- By default `pnpm dev` (`vinext dev`) and `pnpm preview` (without `--local`) open a Cloudflare **remote proxy session** because the `EMAIL` `send_email` binding is `remote: true` in `wrangler.jsonc`; without Cloudflare auth this hangs and fails with `Timed out waiting for authorization code`.
- Fully offline dev (no remote bindings, no login): `CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm dev` — serves `http://localhost:3000/` with all bindings local (D1/KV/R2 via Miniflare). The dev server binds IPv6 `localhost` (`::1`), so use `http://localhost:3000`, not `http://127.0.0.1:3000`. The first request is slow (on-demand Vite compilation); warm requests are fast.
- Or run the built Worker offline: `pnpm build`, then `pnpm exec wrangler dev --local --port 3000 --var APP_TEST_MODE:true` (how the E2E harness in `tests/e2e/e2e-environment.mjs` runs the app).
- For real remote bindings with `pnpm dev`, authenticate first: `pnpx wrangler login`, or set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
- Turnstile captcha auto-disables when `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` are empty (see `src/flags.ts`), so email/password sign-in works locally without `APP_TEST_MODE`. `APP_TEST_MODE:true` also disables it and relaxes rate limiting.
- Local data lives in `.wrangler/state`; seed with `pnpm db:migrate:dev` then `pnpm db:seed` (or `pnpm reset`). Sign in with `test@test.com` / `password`.

### Tests

- E2E (`pnpm run test:e2e`) needs the Playwright Chromium browser (kept in `~/.cache/ms-playwright`, outside the repo); if missing, run `pnpm exec playwright install chromium`. The E2E runner builds the app and starts its own isolated local Wrangler/D1 preview, so no dev server is needed.
