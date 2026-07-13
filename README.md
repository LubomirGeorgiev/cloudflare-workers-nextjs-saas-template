# Cloudflare Workers SaaS Template

[![.github/workflows/deploy.yml](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml/badge.svg)](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml)

# [Live Demo](https://nextjs-saas-template.lubomirgeorgiev.com/sign-up)
# [Github Repo](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template)

This is a SaaS template for Cloudflare Workers. It uses Vinext on Vite to run a Next.js App Router application directly on Cloudflare Workers.

## What is Vinext?

[Vinext](https://vinext.io/) is Cloudflare's experimental implementation of the public Next.js API surface on top of Vite. The goal is to let a Next.js app keep familiar App Router patterns, React Server Components, route handlers, and `next/*` imports while using Vite as the build and dev toolchain instead of the standard Next.js compiler pipeline.

For this template, Vinext is the runtime and deployment path for Cloudflare Workers. `pnpm dev` starts the Vinext development server, `pnpm build` produces the Vinext/Vite production output, and `pnpm deploy` uses `vinext-cloudflare deploy` to build and deploy the Worker. Vinext has first-class Cloudflare Workers support, including access to bindings such as D1, KV, R2, Images, Durable Objects, and AI through `cloudflare:workers`.

Vinext is not a fork of Next.js and is not affiliated with Vercel. It is still experimental, so framework-sensitive changes should be verified with `pnpm run check:vinext`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`.

> [!TIP]
> This template is brought to you by 👉 [Aski.Chat](https://aski.chat?utm_source=saas-template-readme) 👈 - AI customer support agents that answer visitors, capture leads, and surface customer intelligence from every conversation.
>
> - Website-trained AI agents for support and sales
> - Lead capture and qualification from real conversations
> - Learn what customers keep asking, then improve your docs, FAQs, and product
>
> Turn every visitor question into a faster answer and a sharper product signal.

# Supported Features:

- 🔐 Authentication with Lucia Auth
  - 📧 Email/Password Sign In
  - 📝 Email/Password Sign Up
  - 🔑 WebAuthn/Passkey Authentication
  - 🌐 Google OAuth/SSO Integration
  - 🔄 Forgot Password Flow
  - 🔒 Change Password
  - ✉️ Email Verification
  - 🗝️ Session Management with Cloudflare KV
  - 🤖 Turnstile Captcha Integration
  - ⚡ Rate Limiting for Auth Endpoints
  - 🛡️ Protected Routes and Layouts
  - 📋 Session Listing and Management
  - 🔒 Anti-Disposable Email Protection
- 💾 Database with Drizzle and Cloudflare D1
  - 🏗️ Type-safe Database Operations
  - 🔄 Automatic Migration Generation
  - 💻 SQLite for Local Development
  - ⚡ Efficient Data Fetching
  - 🔍 Type-safe Queries
- 📨 Email Service with Cloudflare Email Service
  - 🎨 Beautiful Email Templates
  - 👀 Email Preview Mode
  - 🔧 Local Email Development Server
  - 📬 Transactional Emails
  - ✉️ Email Verification Flow
  - 📱 Responsive Email Templates
- 🚀 Deployment with Github Actions
  - ⚙️ Automatic Deployments
  - 🔐 Environment Variables Management
  - 📦 Database Migrations
  - 🔄 Comprehensive CI/CD Pipeline
  - 🧹 Cache Purging
  - ✅ Type Checking
  - 🧪 Integration Tests
  - 🧪 End-to-end Tests
  - 📏 Deploy Size Tracking
- 🎨 Modern UI
  - 🎨 Tailwind CSS
  - 🧩 Shadcn UI Components
  - 🌓 Dark/Light Mode
  - 📱 Responsive Design
  - ⚡ Loading States and Animations
  - 🔔 Toast Notifications
  - ⚙️ Settings Dashboard
  - 🏠 Landing Page
  - ✨ Beautiful Email Templates
  - 👤 Profile Settings Page
  - 🎯 Form Validation States
- 💳 Team Subscription Billing
  - 🧩 Per-team plans (Free / Pro / Enterprise) defined in code
  - 💳 Embedded Stripe Elements (Payment Element) for checkout — no redirect to hosted pages
  - 🔔 Webhook-driven subscription lifecycle (Stripe is the source of truth)
  - 🔁 In-app plan changes and cancellation
  - 🧾 Stripe Customer Portal for payment methods, invoices, and billing details
  - 🔒 Plan-based entitlements and feature gating (e.g. seat limits)
  - 🛠️ One-command Stripe setup (`pnpm stripe:setup`)
- 👑 Admin Dashboard
  - 👥 User Management
- 📝 Content Management System
  - 🗂️ Config-driven collections for blog and docs content
  - ✍️ Rich TipTap editor with markdown paste, markdown copy, tables, code highlighting, and alert blocks
  - 🧭 Docs navigation builder with managed public URLs
  - 🖼️ Media library with R2-backed image uploads, alt text editing, and featured images
  - 🏷️ Tags and categories with entry usage tracking
  - 🕒 Draft, published, archived, and scheduled entry workflows
  - 🧾 Version history for CMS entries
  - ⚡ KV-backed CMS entry caching and cache maintenance actions
  - 🔍 Full-text docs search
  - 🤖 AI-assisted SEO description generation
  - 🧱 Blog, docs, sitemap.xml, JSON-LD schema, and llms.txt rendering
- ✨ Validations with Zod and React Hook Form
  - 🛡️ Type-safe Form Validations
  - 🔒 Server-side Validations
  - 🔍 Client-side Validations
  - 🧹 Input Sanitization
  - ⚡ Real-time Validation
  - 🔄 Form State Management
- 👨‍💻 Developer Experience
  - 🧪 Local Development Setup
  - 📘 TypeScript Support
  - 🔍 Oxlint Configuration
  - 🧪 Co-located Vitest Unit Tests
  - 🧪 Cloudflare Workers Vitest Integration Tests
  - 🧪 Vitest and Playwright E2E Tests
  - ⚡ Vinext and Vite Build Pipeline
  - 🔐 Type-safe Environment Variables
  - 🏗️ Cloudflare Types Generation
  - 🤖 AI-powered Development with AI Agents
  - 📚 Comprehensive Documentation
  - 📐 Project Structure Best Practices
- ⚡ Edge Computing
  - 🌍 Global Deployment with Cloudflare Workers
  - 🚀 Zero Cold Starts
  - 💨 Edge Caching
  - ⚛️ React Server Components
  - 🖥️ Server-side Rendering
  - 💾 Edge Database with D1
  - 🗄️ Session Storage with KV
  - 🖼️ Cloudflare Images-powered Image Optimization
  - ⚡ API Rate Limiting
- 🏢 Multi-tenancy Support
  - 👥 Organization Management
  - 👤 User Roles and Permissions
  - 🔍 Tenant Isolation
  - 🔄 Resource Sharing Controls
  - 📊 Per-tenant Analytics
  - 🔐 Tenant-specific Configurations
  - 💼 Team Collaboration Features
- 🌐 Internationalization (i18n) with next-intl
  - 🍪 Cookie-based locale with Accept-Language negotiation (no URL changes)
  - 🔀 Locale switcher in the footer
  - 🗂️ JSON message catalogs (English and Spanish included)
  - 🧭 Auto-detected by Vinext (no `createNextIntlPlugin` wrapper needed)
  - 🔒 Type-safe message keys

## Internationalization (i18n)

The template ships with [next-intl](https://next-intl.dev/) configured in
"without i18n routing" mode: the active locale is resolved from a `NEXT_LOCALE`
cookie, falling back to the request's `Accept-Language` header and then the
default locale, so URLs stay unchanged across the app.

Everything lives in `src/i18n/`:

- `config.ts` — locale list, default locale, cookie name, and switcher labels.
- `request.ts` — the Vinext-auto-detected next-intl request config.
- `locale.ts` / `locale-actions.ts` — server-side locale resolution and the cookie-setting server action.
- `messages/<locale>.json` — one message catalog per locale.

To add a locale (e.g. French):

1. Add `"fr"` to `LOCALES` and a `fr` entry to `LOCALE_LABELS` in `src/i18n/config.ts`.
2. Create `src/i18n/messages/fr.json` mirroring the keys in `en.json`.

Use `useTranslations` in client components and `getTranslations` in server
components. `messages/en.json` is the source of truth for type-safe keys via the
augmentation in `src/i18n/next-intl.d.ts`.

## Planned features (TODO):

- [ ] Update Meta SEO tags 🔍
- [ ] Dynamic OpenGraph images 📸
- [ ] Notifications 🔔
- [ ] Webhooks 🔗

# Running it locally

1. `pnpm install`
2. `pnpx wrangler login` - Login to your Cloudflare account to use Cloudflare bindings while testing locally.
3. Copy `.env.example` to `.env` and fill in the values.
4. `pnpm db:migrate:dev` - Creates a local SQLite database and applies migrations
5. `pnpm db:seed` - Seeds the database with test data
6. `pnpm dev` - Starts the Vinext development server
7. Go to http://localhost:3000/sign-in and login with the test user credentials: test@test.com / password
8. Go to http://localhost:3000/admin to manage users and the CMS.

## Billing setup (team subscriptions)

Billing is per-team: each team owns a single Stripe subscription to a plan (Free / Pro / Enterprise). Plans are defined in code in [`src/constants/plans.json`](src/constants/plans.json) and consumed by both the app and the setup script, so Stripe and code never drift. Payment collection uses embedded Stripe Elements (the Payment Element), and plan changes/cancellation are handled by in-app server actions. The hosted [Stripe Customer Portal](https://docs.stripe.com/customer-management) complements this for self-service payment method updates, invoice history, and billing details — the billing page shows a "Manage billing" button once the team has a Stripe customer.

The subscription lifecycle is **webhook-driven**: Stripe is the source of truth and the DB is a cache updated from webhook events. The app never mutates subscription state from the client's `confirmPayment` result alone.

Billing is enabled only when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are all set (see `isBillingEnabled()` in [`src/flags.ts`](src/flags.ts)); otherwise the billing UI is hidden and the webhook route no-ops.

Happy path:

1. Create a Stripe account and copy `sk_test_...` / `pk_test_...` into `.env` (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
2. Run `pnpm stripe:setup` — this idempotently creates the products + recurring prices for the paid plans and, by default, upserts the resolved `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE` values into `.env` (replacing existing keys in place, never duplicating). When yearly billing is enabled (see below) it also creates the yearly prices and writes `STRIPE_PRICE_PRO_YEAR` / `STRIPE_PRICE_ENTERPRISE_YEAR`. It refuses to run against a live key unless you pass `--live`. Use `--dry-run` to preview without changing anything, or `--no-write` to create the Stripe resources but only print the values instead of touching `.env`.
3. Local webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then copy the printed `whsec_...` into `.env` as `STRIPE_WEBHOOK_SECRET`.
4. Production: `pnpm stripe:setup --with-webhook https://<domain>/api/stripe/webhook`, then set the secrets via `wrangler secret put STRIPE_SECRET_KEY` and `wrangler secret put STRIPE_WEBHOOK_SECRET`.
5. Manual Dashboard alternative: create the Products + recurring Prices yourself, add a webhook endpoint for the subscription/invoice events to `/api/stripe/webhook`, and copy the price IDs + signing secret into your env.
6. Customer Portal: `pnpm stripe:setup` also provisions a portal configuration (written to `.env` as `STRIPE_PORTAL_CONFIG_ID`) that enables payment method updates, invoice history, and billing-details editing — including business name, address, and VAT/tax IDs, which Stripe prints on invoices automatically. Plan changes and cancellation are deliberately disabled in the portal because they're handled by in-app server actions; keeping a single code path avoids conflicting subscription state. If `STRIPE_PORTAL_CONFIG_ID` is unset, sessions fall back to the account's default portal configuration ([Settings → Billing → Customer portal](https://dashboard.stripe.com/settings/billing/portal)).

The billing page lives at `/dashboard/teams/[teamSlug]/billing` (the generic `/dashboard/billing` nav item redirects there for the selected team).

**Yearly billing:** set `yearlyDiscountPercent` in [`src/constants/plans.json`](src/constants/plans.json) (e.g. `20`) to offer every monthly paid plan as a yearly subscription at that percentage off — the yearly amount is derived as `monthly × 12 × (100 − discount) / 100`, the billing page gains a Monthly/Yearly toggle with a "Save X%" badge, and existing subscribers can switch interval in place (prorated by Stripe). Re-run `pnpm stripe:setup` after changing it so the yearly prices exist. Remove the key to keep billing monthly-only.

**Entitlements & downgrades:** feature access is derived from the team's plan via `getTeamEntitlements` ([`src/utils/entitlements.ts`](src/utils/entitlements.ts)). Plan limits (e.g. seats) are enforced only at *grow* points such as inviting members — a team that drops to a lower plan keeps its existing members and is never auto-evicted.

## End-to-end tests

E2E tests use Vitest with Playwright-driven Chromium pages and run against the production-style local Worker preview.

After cloning the project, install the Playwright Chromium browser once on your machine:

```bash
pnpm exec playwright install chromium
```

This browser binary is not downloaded automatically by `pnpm install`. It is kept outside the repo in Playwright's local browser cache, so you normally only need to run the install command after a fresh machine setup, a new Playwright version, or a cleared Playwright cache.

Run the E2E suite with:

```bash
pnpm run test:e2e
```

The E2E runner stores its temporary files under `tmp/e2e`, creates a fresh local Wrangler/D1 state under `tmp/e2e/wrangler-state`, applies all D1 migrations, runs `src/db/seed.sql`, builds the app, starts Wrangler preview on that isolated state, then runs the browser tests against the preview Worker. If the existing `dist` output matches the current build input fingerprint, the runner reuses that fresh Vinext build instead of rebuilding. The build and D1 setup run in parallel, and Vitest runs test files in parallel with isolated Playwright browser contexts. This keeps E2E data separate from your normal local `.wrangler` development state.

VS Code Vitest Explorer is configured through `.vscode/settings.json` to use `vitest.e2e.config.ts`. Running an individual E2E test from the editor uses Vitest global setup to create the same isolated Wrangler/D1 state and preview Worker before the selected test starts.

In CI, install Chromium before running the suite:

```bash
pnpm exec playwright install --with-deps chromium
pnpm run test:e2e
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Vinext development server |
| `pnpm build` | Build the app with Vinext and Vite |
| `pnpm start` | Start the local Vinext production server |
| `pnpm preview` | Build, then preview the Worker locally with Wrangler |
| `pnpm run test:unit` | Run co-located Vitest unit tests |
| `pnpm run test:integration` | Run Cloudflare Workers Vitest integration tests with local D1/KV/Queue bindings |
| `pnpm run test:e2e` | Run Playwright-driven E2E tests against a clean local Wrangler/D1 preview |
| `pnpm deploy` | Build and deploy with `vinext-cloudflare deploy` |
| `pnpm deploy:dryrun` | Build and run a Wrangler deploy dry run into `worker-dist` |
| `pnpm check:vinext` | Run the Vinext compatibility checker |
| `pnpm run lint` | Run Oxlint |
| `pnpm run typecheck` | Run TypeScript without emitting files |
| `pnpm run cf-typegen` | Regenerate Cloudflare Worker types |

## Changes to wrangler.jsonc

After making a change to `wrangler.jsonc`, run `pnpm run cf-typegen` to regenerate `worker-configuration.d.ts`.

Cloudflare bindings are defined in `wrangler.jsonc` and exposed to server code through `cloudflare:workers` or the local helper in `src/utils/cloudflare-context.ts`. The custom Worker entry lives in `worker-entrypoint.ts` and is configured as the `main` entry in `wrangler.jsonc`.

## Things to change and customize before deploying to production

1. Go to `src/constants.ts` and update it with your project details
2. Update the `name` field in `package.json` to your project name so generated metrics and package metadata identify the reused template correctly
3. Update `AGENTS.md` with your project specification so that AI coding agents can give you better suggestions
4. Update the footer in `src/components/footer.tsx` with your project details and links
5. Optional: Update the color palette in `src/app/globals.css`
6. Update the metadata in `src/app/layout.tsx` with your project details
7. Update `cms.config.ts` if necessary

## Production deployment

The source of truth for preparing and deploying this template to production is the repo-local AI agent skill at `.agents/skills/prepare-cloudflare-production-deployment/SKILL.md`.

That skill covers Cloudflare resource provisioning with [Cloudflare MCP](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/), GitHub Actions secrets and variables with the [GitHub CLI](https://cli.github.com/), `wrangler.jsonc` binding updates, Worker secrets, Turnstile, Email Sending, and deployment verification.
