# Cloudflare Workers Next.js SaaS Template - AI Assistant Guidelines

Use this file for repo-specific rules. For product overview, features, setup, and deployment details, refer to `README.md`.

## Project Context

Production-ready Next.js SaaS template running on Cloudflare Workers with Vinext and Vite. Core areas include authentication, multi-tenancy, billing, admin tools, and email workflows.

Primary stack:
- Next.js App Router
- React Server Components
- TypeScript
- Tailwind CSS
- Vinext and Vite
- Shadcn UI / Base UI
- Drizzle ORM
- Cloudflare Workers, D1, KV, R2, Images
- Lucia Auth
- Zustand and NUQS

## Vinext Context

Vinext is Cloudflare's experimental Vite-based implementation of the public Next.js API surface. This project still uses familiar Next.js App Router conventions, React Server Components, route handlers, server actions, and `next/*` imports, but the dev, build, start, and deploy lifecycle runs through Vinext and Vite.

Use Vinext commands for framework work:
- `pnpm dev` starts the Vinext development server.
- `pnpm build` builds with Vinext and Vite.
- `pnpm start` starts the local Vinext production server.
- `pnpm deploy` runs `vinext-cloudflare deploy` for Cloudflare Workers.
- `pnpm run check:vinext` scans compatibility with the Vinext implementation.

Do not reintroduce legacy `next dev`, `next build`, or OpenNext commands unless the user explicitly asks to migrate away from Vinext. Treat Vinext as experimental: for changes touching routing, RSC/server actions, Cloudflare bindings, middleware, build config, or deployment, run `pnpm run check:vinext`, `pnpm run typecheck`, and `pnpm run build` when feasible. Primary references are https://vinext.io/ and https://github.com/cloudflare/vinext.

## General Coding Rules

- Write concise, technical TypeScript code.
- Prefer functional and declarative patterns. Avoid classes.
- Prefer iteration and modularization over duplication.
- Use descriptive names such as `isLoading` and `hasError`.
- Favor named exports.
- Use lowercase with dashes for directories.
- Structure files as: exported component, subcomponents, helpers, static content, types.
- Never delete comments unless they are no longer relevant.

### Comments

- Do not comment obvious code.
- Add comments only for non-trivial logic, edge cases, workarounds, or business rules.
- Comments should explain why, not what.
- Keep comments to 3 lines max, and to the point. Longer comments do not get read.
- Keep TODO comments unless the work is actually completed and verified.

### Functions and Types

- When a function has more than one parameter, pass a named object.
- Use the `function` keyword for pure functions.
- Prefer interfaces over types when practical.
- Avoid enums; use maps or const objects instead.
- Do not edit the generated `worker-configuration.d.ts` by hand; update `wrangler.jsonc` and run `pnpm run cf-typegen`.

### Imports and Packages

- Add `import "server-only"` to server-only modules, except `page.tsx`.
- Before adding a package, check `package.json` first.
- Use `pnpm` for all package management.

### Verification

- Use `pnpm run lint` to verify lint rules with Oxlint.
- Use `pnpm run typecheck` to verify TypeScript correctness.
- Use `pnpm run test:unit` to run co-located unit tests such as `*.test.ts`.
- Use `pnpm run test:integration` to verify Workers-runtime integration behavior with local Miniflare D1, KV, and Queue bindings, especially for subscription billing (Stripe webhook handling), scheduler, Cloudflare binding, and SQL-condition changes.
- Use `pnpm run test:e2e` to verify end-to-end flows when changes could affect user journeys, routing, auth, or other integrated behavior.
- Run `pnpx fallow audit` when work is done to audit the final changes before handing work back.
- Run these commands after code changes when feasible, especially before handing work back.

### Template-Safe Tests

- This repository is a template. Write tests so they continue to pass in downstream projects that customize names, domains, branding, Cloudflare resource names, feature flags, and environment constants.
- Avoid hard-coded template-specific URLs, project names, resource names, and branded copy in assertions unless the value under test is intentionally fixed by the template contract.
- Prefer deriving expected values from shared constants, configuration, generated fixtures, response payload structure, or invariant pathnames and behavior.
- When a feature can be disabled by a template flag, make tests flag-aware: skip enabled-feature behavior when disabled and include focused no-op or fallback coverage for the disabled mode.

## DRY Rules

- Extract repeated values into constants, especially validation limits.
- Extract repeated formatting and repeated code paths into utilities/helpers.
- Reuse existing types, constants, helpers, and schemas before creating new ones.
- Centralize cache tags and shared cache helpers in `src/utils/cache.ts`.
- Prefer clear code over premature abstraction for simple one-off patterns.

Suggested homes:
- Constants: `src/constants.ts` or `src/app/enums.ts`
- Utilities: `src/utils/` or `src/lib/`
- Schemas: `src/schemas/`
- Shared types: same file or `src/types.ts`

## Frontend and Next.js

- Prefer server components. Limit `use client`, `useEffect`, and local state.
- Use React.cache (`cache` from `react`) for reusable server-side read functions that may be called multiple times during one RSC render/request, especially request-scoped auth/session/config/database reads. Do not wrap mutations, server actions, route handlers, or functions whose result must change within the same request.
- Use client components only when needed for browser APIs or small interactive UI.
- Wrap client components in `Suspense` where appropriate.
- When layout or shell chrome needs independent async server data, move that data into a small server wrapper component and render it behind a local `Suspense` fallback. Do not make the entire layout async unless the layout must block for auth, redirects, request-scoped data, or other decisions that affect the whole route.
- Use dynamic loading for non-critical UI when useful.
- Use `nuqs` for URL search parameter state.
- Use declarative JSX and concise conditionals.
- `src/proxy.ts` runs next-intl on all paths except an exclusion list of non-public routes. When adding a new top-level non-public/authed section (outside `app/[locale]/`, like `/dashboard`), add its segment to that matcher; public pages need no change.
- Use Tailwind, Shadcn UI, and Base UI consistently with the existing design system.
- Implement responsive, mobile-first layouts and support light/dark mode.
- When using a `container` class, also use `mx-auto`.

## Authentication

Authentication is based on Lucia Auth.

- Auth logic lives in `src/utils/auth.ts` and `src/utils/kv-session.ts`.
- In server components, access the session via `getSessionFromCookie` from `src/utils/auth.ts`.
- In client components, access the session via `useSessionStore()` from `src/state/session.ts`.
- AI agents may use the test credentials `test@test.com` / `password` with browser automation to test authenticated flows.

## Database and Migrations

- Schema lives in `src/db/schema.ts`.
- Never use Drizzle transactions because Cloudflare D1 does not support them.
- Do not pass `id` when inserting or updating records with Drizzle; IDs are autogenerated in the schema.
- Do not generate SQL migration files manually. After schema changes, run `pnpm db:generate [MIGRATION_NAME]`.
- A commit must NEVER contain multiple new migrations unless a human is explicitly asked and gives permission. Without that permission, consolidate before committing: delete the incremental migration files, regenerate a single migration from the final schema, and reset/re-migrate local dev database state so its journal matches the regenerated files.

### D1/SQLite Schema-Change Safety

- Never introduce database-level defaults in D1 schemas. Do not use Drizzle `.default(...)` or otherwise emit a SQL `DEFAULT` clause, including for new tables and columns. Supply values explicitly on every insert; when appropriate, a Drizzle runtime default such as `$defaultFn()` may generate the application value without changing the database schema. Do not remove or change a production column's existing default solely to comply with this rule because that change can itself rebuild the table; handle legacy defaults only through a separately reviewed migration.
- With the currently pinned `drizzle-kit`, any of these changes to an existing table cause a full replacement-table migration: changing a column's type/SQLite affinity, SQL `DEFAULT`, nullability, or `AUTOINCREMENT`; adding, removing, or changing a `PRIMARY KEY`, schema-level `UNIQUE` constraint, `CHECK` constraint, foreign key, foreign-key action, or foreign-key deferrability; adding a `STORED` generated column; or changing a generated column to `STORED`. Re-audit generated SQL whenever `drizzle-kit` is upgraded.
- Other SQLite table-definition changes that require the generalized create-copy-drop-rename procedure include changing a column's collation or position; changing constraint conflict policies; changing `INTEGER PRIMARY KEY`/`ROWID` behavior; changing `STRICT` or `WITHOUT ROWID`; and converting between ordinary, virtual, or FTS tables. Do not attempt these as manual schema edits.
- Prefer independent Drizzle `index()` and `uniqueIndex()` definitions over schema-level `.unique()` constraints when the key is not a primary/foreign-key invariant. Creating, dropping, or changing an independent index only creates or rebuilds that index; adding, dropping, or changing a schema-level unique constraint rebuilds the table. Changing an index means dropping and recreating it because SQLite cannot alter an index in place.
- Direct, no-table-copy operations are limited to renaming a table, renaming a column, adding a compatible column, and creating or dropping independent indexes, triggers, and views. A rename must remain a pure rename: if Drizzle interprets it as drop-and-add or combines it with another structural change, stop. Renames can fail rather than rebuild when a trigger or view would become ambiguous; never enable `PRAGMA legacy_alter_table` to bypass reference updates.
- Under the no-database-default rule, a compatible `ADD COLUMN` is a nullable ordinary column, a nullable inline foreign-key column, or a `VIRTUAL` generated column without constraints that require validation. It cannot be `PRIMARY KEY`, `UNIQUE`, or `STORED`. Do not directly add a `NOT NULL` column to a populated table; SQLite requires a non-null database default, which this project prohibits. Adding a `CHECK` constraint or `NOT NULL` generated column scans every existing row, and the current Drizzle generator rebuilds the table for a `CHECK` change.
- Treat `DROP COLUMN` as a full-row-rewrite operation even though modern SQLite supports it directly. It fails if the column participates in a primary/unique key, index, partial-index predicate, check constraint, foreign key, generated expression, trigger, or view. Changing or removing a `VIRTUAL` generated column may be emitted as `DROP COLUMN` plus `ADD COLUMN`; treat that as destructive and inspect all dependencies.
- After `pnpm db:generate`, inspect the complete generated SQL and snapshot diff before applying it locally or remotely. If the migration contains `CREATE TABLE __new_*`, `INSERT INTO __new_* ... SELECT`, `DROP TABLE`, a replacement-table rename, `PRAGMA foreign_keys=OFF`, or a `DROP COLUMN`/`ADD COLUMN` replacement pair, stop and do not apply or deploy it. First determine whether schema, snapshot, or migration-history drift caused it, correct the source of the drift, and regenerate. Never delete or hand-edit only the rebuild statements from a generated migration.
- D1 keeps foreign-key enforcement active during migrations, so `PRAGMA foreign_keys=OFF` in generated replacement-table SQL does not make it safe. With foreign keys active, `DROP TABLE` performs an implicit delete and may invoke `ON DELETE` actions, including cascades, or fail on constraints. `PRAGMA defer_foreign_keys=true` delays constraint checks but does not suppress cascade actions; use it only in an explicitly approved migration.
- D1 limits a SQL query to 30 seconds. A replacement table's single `INSERT ... SELECT` copy can exceed that limit and cannot be treated like a safely batched application backfill. Batch large data backfills separately and keep them out of schema migrations.
- Do not add `VACUUM` or `REINDEX` to D1 migrations. In SQLite, `VACUUM` rebuilds the entire database file and `REINDEX` rebuilds indexes; use D1-supported maintenance operations such as `PRAGMA optimize` when appropriate.
- If a production table rebuild is genuinely unavoidable, obtain explicit user approval first. Document the affected row count and database size, D1 backup/Time Travel recovery point, maintenance and locking impact, foreign-key handling, preservation of indexes/triggers/views, and a tested rollback or recovery plan. Batch large data backfills instead of placing them in one long D1 query.
- References: [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html), [SQLite DROP TABLE](https://www.sqlite.org/lang_droptable.html), [Cloudflare D1 generated columns](https://developers.cloudflare.com/d1/reference/generated-columns/), [Cloudflare D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Cloudflare Rules

- Cloudflare bindings are available through `cloudflare:workers` in server-only code. Use `getCloudflareContext` when code also needs forwarded request `cf` metadata.
- Cloudflare Workers integration tests live under `tests/integration/` and run with `vitest.integration.config.ts`; prefer them when real D1/KV/Queue behavior matters more than mocked unit tests.
- When introducing a new environment variable, add it to `.env.example` unless it is a public value hard-coded in `wrangler.jsonc`. If the variable's purpose is not 100% obvious, add a short comment above it.
- If you add a new Cloudflare primitive in `wrangler.jsonc`, run `pnpm run cf-typegen`.
- If using KV, always reuse the existing namespace in `wrangler.jsonc`; do not create a new one unless explicitly required.
- Cloudflare Queue messages have payload size limits. Keep queue payloads minimal: pass stable identifiers and small primitive fields, then load full records/blob content from D1, KV, R2, or other storage inside the consumer.
- The Worker entrypoint is `worker-entrypoint.ts`; keep edge-only routing and header forwarding there.
- Suggest Wrangler commands when relevant.

### Cloudflare MCP

When using Cloudflare MCP `execute` for account inventory or deployment prep, do not bundle Turnstile (`/accounts/{account_id}/challenges/widgets`) and Images (`/accounts/{account_id}/images/v1/*`) API calls in the same invocation. Query them in separate MCP calls. Bundling them together can fail the entire request with `10000: Authentication error`, even when other account endpoints work individually.

## State, Security, and Performance

- Prefer React Server Components for server state.
- Use Zustand only where client state is actually needed.
- Use NUQS for URL state.
- Preserve rate limiting, input validation, and sanitization patterns.
- Optimize for Web Vitals and efficient data fetching.

## Forms, Validation, and Server Actions

### Schemas

- All Valibot schemas must live in `src/schemas/`.
- Import `v` and shared validation helpers from `src/lib/validation.ts` instead of importing Valibot directly in schema files.
- Reuse the same schema on both client and server.
- Do not duplicate validation logic between React Hook Form and server actions.
- Export both the schema and its inferred type.

Example:

```typescript
import { emailString, minString, v } from "@/lib/validation";

export const mySchema = v.object({
  email: emailString(),
  password: minString(8),
});

export type MySchema = v.InferOutput<typeof mySchema>;
```

### Localized Validation Messages

- User-facing schema messages should be stable validation keys, not inline English copy.
- Use helpers from `src/lib/validation.ts` such as `requiredString`, `emailString`, `minString`, `maxString`, and `minMaxString` so common rules emit localized `Validation.*` keys automatically.
- For custom validation messages, use `validationKey("messageName")` or `encodeValidationMessage("messageName", params)` from `src/lib/validation.ts`; never hard-code the `Validation.` prefix in schemas.
- Add new validation keys to `Client.Validation` in every locale catalog under `src/i18n/messages/`.
- `FormMessage` and `actionClient` validation error handling translate keyed messages with `translateValidationKey`; non-keyed inline messages pass through unchanged and should not be used for user-facing form validation.

### Server Actions

- All form-handling server actions must use `actionClient` from `src/lib/safe-action.ts`.
- Define validation with `.inputSchema(schema)`.
- For authenticated actions, follow existing patterns such as `src/app/(settings)/settings/settings.actions.ts` for `requireVerifiedEmail`, rate limiting with `withRateLimit`, and Next.js cache invalidation with `revalidatePath`.
- For more complex authenticated actions that also invalidate CMS/KV caches, refer to `src/app/(admin)/admin/_actions/cms-media-actions.ts` such as `deleteCmsMediaAction` and `updateCmsMediaAction`.

### Client Forms

- Use `react-hook-form` with `valibotResolver(schema)`.
- Use `useAction` from `next-safe-action/hooks` to call server actions.
- Use toast notifications for loading, success, and error states.

Reference implementation:
- Server action: `src/app/(auth)/sign-up/sign-up.actions.ts`
- Client form: `src/app/(auth)/sign-up/sign-up.client.tsx`
- Schema: `src/schemas/signup.schema.ts`

## Cursor Cloud specific instructions

Standard dependency install, DB, test, lint, build, and run commands are in `README.md` and `package.json` scripts. Notes below are non-obvious caveats for this environment.

### Node version (critical)
- The build toolchain (`@cloudflare/vite-plugin` → `vinext build`/`pnpm build`) requires Node **>= 22.15** (`node:module`'s `registerHooks`). The VM's default `/exec-daemon/node` is 22.14 and will fail `pnpm build`/`pnpm dev` with `SyntaxError: ... does not provide an export named 'registerHooks'`.
- The environment is configured to use Node 24 via nvm (`nvm alias default 24`), and `~/.bashrc` prepends the nvm default node ahead of `/exec-daemon`. New shells should already run Node 24 with `pnpm` available. If a shell resolves the wrong Node, run `nvm use 24` (or re-source `~/.bashrc`).

### Running the app locally
- By default `pnpm dev` (`vinext dev`) and `pnpm preview` (without `--local`) open a Cloudflare **remote proxy session** because the `EMAIL` `send_email` binding is `remote: true` in `wrangler.jsonc`. Without Cloudflare auth this hangs and fails with `Timed out waiting for authorization code`.
- To run the dev server fully offline (no remote bindings, no Cloudflare login), set the `@cloudflare/vite-plugin` force-local flag: `CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm dev`. This serves the app at `http://localhost:3000/` with all bindings local (D1/KV/R2 via Miniflare). Note the dev server binds IPv6 `localhost` (`::1`), so use `http://localhost:3000` rather than `http://127.0.0.1:3000`. The first request is slow due to on-demand Vite compilation, then warm requests are fast.
- Alternatively, run the built Worker offline: `pnpm build`, then `pnpm exec wrangler dev --local --port 3000 --var APP_TEST_MODE:true` (this is how the E2E harness in `tests/e2e/e2e-environment.mjs` runs the app).
- To use the standard `pnpm dev` with real remote bindings, authenticate first (`pnpx wrangler login`, or set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).
- Turnstile captcha is auto-disabled when `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` are empty (see `src/flags.ts`), so email/password sign-in works locally without `APP_TEST_MODE`. `APP_TEST_MODE:true` also disables it and relaxes rate limiting.
- Local data lives in `.wrangler/state`; seed it with `pnpm db:migrate:dev` then `pnpm db:seed` (or `pnpm reset`). Sign in with `test@test.com` / `password`.

### Tests
- E2E (`pnpm run test:e2e`) needs the Playwright Chromium browser (kept in `~/.cache/ms-playwright`, outside the repo). If it is ever missing, run `pnpm exec playwright install chromium`. The E2E runner builds the app and starts its own isolated local Wrangler/D1 preview, so it does not need the dev server running.
