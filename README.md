# Cloudflare Workers SaaS Template

[![.github/workflows/deploy.yml](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml/badge.svg)](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml)

# [Live Demo](https://nextjs-saas-template.lubomirgeorgiev.com/sign-up)
# [Github Repo](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template)

This is a SaaS template for Cloudflare Workers. It uses Vinext on Vite to run a Next.js App Router application directly on Cloudflare Workers.

## What is Vinext?

[Vinext](https://vinext.io/) is Cloudflare's experimental implementation of the public Next.js API surface on top of Vite. The goal is to let a Next.js app keep familiar App Router patterns, React Server Components, route handlers, and `next/*` imports while using Vite as the build and dev toolchain instead of the standard Next.js compiler pipeline.

For this template, Vinext is the runtime and deployment path for Cloudflare Workers. `pnpm dev` starts the Vinext development server, `pnpm build` produces the Vinext/Vite production output, and `pnpm deploy` uses `vinext deploy` to build and deploy the Worker. Vinext has first-class Cloudflare Workers support, including access to bindings such as D1, KV, R2, Images, Durable Objects, and AI through `cloudflare:workers`.

Vinext is not a fork of Next.js and is not affiliated with Vercel. It is still experimental, so framework-sensitive changes should be verified with `pnpm run check:vinext`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`.

> [!TIP]
> This template is brought to you by 👉 [AgenticDev](https://agenticdev.agency/?ref=github-readme-nextjs-template) 👈 - where we help businesses automate operations and boost productivity through custom AI implementations. Just like this open-source project demonstrates technical excellence, we deliver:
>
> - Process automation with LLM-powered workflows
> - AI strategy consulting for sustainable scaling
> - Custom SaaS development using cutting-edge stacks
>
> Hundrets of developers already trust our codebase - Just Imagine what we could build for your business.

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
- 💳 Credit Billing System
  - 💰 Credit-based Pricing Model
  - 🔄 Monthly Credit Refresh
  - 📊 Credit Usage Tracking
  - 💳 Stripe Payment Integration
  - 📜 Transaction History
  - 📦 Credit Package Management
  - 💸 Pay-as-you-go Model
  - 📈 Usage Analytics
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
  - ⚡ Vinext and Vite Build Pipeline
  - 🔐 Type-safe Environment Variables
  - 🏗️ Cloudflare Types Generation
  - 🤖 AI-powered Development with Cursor
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

## Planned features (TODO):

- [ ] Add Oxlint coverage for unused exports
- [x] Add an Oxlint rule to check for unused variables and imports
- [ ] Upgrade to Tailwind 4 and fix the errors and visual regressions. Already started here https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/tree/tailwind-4-upgrade
- [ ] Update Meta SEO tags 🔍
- [ ] Dynamic OpenGraph images 📸
- [ ] sitemap.xml 📄
- [ ] robots.txt 📄
- [ ] Multi-language support (i18n) 🌐
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

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the Vinext development server |
| `pnpm build` | Build the app with Vinext and Vite |
| `pnpm start` | Start the local Vinext production server |
| `pnpm preview` | Build, then preview the Worker locally with Wrangler |
| `pnpm deploy` | Build and deploy with `vinext deploy` |
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
3. Update `AGENTS.md` with your project specification so that Cursor AI can give you better suggestions
4. Update the footer in `src/components/footer.tsx` with your project details and links
5. Optional: Update the color palette in `src/app/globals.css`
6. Update the metadata in `src/app/layout.tsx` with your project details
7. Update `cms.config.ts` if necessary

## Deploying to Cloudflare with Github Actions

1. Create D1, KV, and R2 resources, and make sure Cloudflare Images is enabled for your account.
2. Onboard your sending domain in Cloudflare Email Service, then update `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, and the `send_email.allowed_sender_addresses` entry in `wrangler.jsonc`. The Worker uses the `EMAIL` Email Service binding to send transactional email.
3. Create a Turnstile catcha in your Cloudflare account, and set the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a Github Actions variable.
4. Set `TURNSTILE_SECRET_KEY` as a secret in your Cloudflare Worker.
5. Update the `wrangler.jsonc` file with the new database, KV namespace, R2 bucket, env variables, Images binding, email binding, and account id. Search for "cloudflare-workers-nextjs-saas-template" recursively in the whole repository and change that to the name of your project.
6. Go to https://dash.cloudflare.com/profile/api-tokens and click on "Use template" next to "Edit Cloudflare Workers". On the next, page add the following permissions in addition to the ones from the template:
    - Account:AI Gateway:Edit
    - Account:Workers AI:Edit
    - Account:Workers AI:Read
    - Account:Queues:Edit
    - Account:Vectorize:Edit
    - Account:D1:Edit
    - Account:Cloudflare Images:Edit
    - Account:Workers KV Storage:Edit
    - Account:Email Sending:Edit
    - Zone:Cache Purge:Purge
7. Add the API token to the Github repository secrets as `CLOUDFLARE_API_TOKEN`
8. Add the Cloudflare account id to the Github repository variables as `CLOUDFLARE_ACCOUNT_ID`
9. Optional: If you want clear the CDN cache on deploy, add `CLOUDFLARE_ZONE_ID` to the Github repository variables for the zone id of your domain. This is the zone id of your domain, not the account id.
10. Push to the main branch. The workflow installs with `pnpm install --frozen-lockfile`, runs lint and typecheck, deploys with `pnpm run deploy`, applies D1 migrations, optionally purges the CDN cache, and records deploy size metrics in `metrics/deploy-size-history.jsonl`.
