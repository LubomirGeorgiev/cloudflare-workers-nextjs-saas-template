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
- `pnpm deploy` runs `vinext deploy` for Cloudflare Workers.
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
- Use `pnpm run test:integration` to verify Workers-runtime integration behavior with local Miniflare D1, KV, and Queue bindings, especially for credit billing, scheduler, Cloudflare binding, and SQL-condition changes.
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
- Use Tailwind, Shadcn UI, and Base UI consistently with the existing design system.
- Implement responsive, mobile-first layouts and support light/dark mode.
- When using a `container` class, also use `mx-auto`.

## Authentication

Authentication is based on Lucia Auth.

- Auth logic lives in `src/utils/auth.ts` and `src/utils/kv-session.ts`.
- In server components, access the session via `getSessionFromCookie` from `src/utils/auth.ts`.
- In client components, access the session via `useSessionStore()` from `src/state/session.ts`.

## Database and Migrations

- Schema lives in `src/db/schema.ts`.
- Never use Drizzle transactions because Cloudflare D1 does not support them.
- Do not pass `id` when inserting or updating records with Drizzle; IDs are autogenerated in the schema.
- Do not generate SQL migration files manually. After schema changes, run `pnpm db:generate [MIGRATION_NAME]`.

## Cloudflare Rules

- Cloudflare bindings are available through `cloudflare:workers` in server-only code. Use `getCloudflareContext` when code also needs forwarded request `cf` metadata.
- Cloudflare Workers integration tests live under `tests/integration/` and run with `vitest.integration.config.ts`; prefer them when real D1/KV/Queue behavior matters more than mocked unit tests.
- When introducing a new environment variable, add it to `.env.example` unless it is a public value hard-coded in `wrangler.jsonc`. If the variable's purpose is not 100% obvious, add a short comment above it.
- If you add a new Cloudflare primitive in `wrangler.jsonc`, run `pnpm run cf-typegen`.
- If using KV, always reuse the existing namespace in `wrangler.jsonc`; do not create a new one unless explicitly required.
- Cloudflare Queue messages have payload size limits. Keep queue payloads minimal: pass stable identifiers and small primitive fields, then load full records/blob content from D1, KV, R2, or other storage inside the consumer.
- The Worker entrypoint is `worker-entrypoint.ts`; keep edge-only routing and header forwarding there.
- Suggest Wrangler commands when relevant.

## State, Security, and Performance

- Prefer React Server Components for server state.
- Use Zustand only where client state is actually needed.
- Use NUQS for URL state.
- Preserve rate limiting, input validation, and sanitization patterns.
- Optimize for Web Vitals and efficient data fetching.

## Forms, Validation, and Server Actions

### Schemas

- All Zod schemas must live in `src/schemas/`.
- Reuse the same schema on both client and server.
- Do not duplicate validation logic between React Hook Form and server actions.
- Export both the schema and its inferred type.

Example:

```typescript
import { z } from "zod"

export const mySchema = z.object({
  email: z.string().email(),
})

export type MySchema = z.infer<typeof mySchema>
```

### Server Actions

- All form-handling server actions must use `actionClient` from `src/lib/safe-action.ts`.
- Define validation with `.inputSchema(schema)`.
- For authenticated actions, follow existing patterns such as `src/app/(settings)/settings/settings.actions.ts` for `requireVerifiedEmail`, rate limiting with `withRateLimit`, and Next.js cache invalidation with `revalidatePath`.
- For more complex authenticated actions that also invalidate CMS/KV caches, refer to `src/app/(admin)/admin/_actions/cms-media-actions.ts` such as `deleteCmsMediaAction` and `updateCmsMediaAction`.

### Client Forms

- Use `react-hook-form` with `zodResolver(schema)`.
- Use `useAction` from `next-safe-action/hooks` to call server actions.
- Use toast notifications for loading, success, and error states.

Reference implementation:
- Server action: `src/app/(auth)/sign-up/sign-up.actions.ts`
- Client form: `src/app/(auth)/sign-up/sign-up.client.tsx`
- Schema: `src/schemas/signup.schema.ts`
