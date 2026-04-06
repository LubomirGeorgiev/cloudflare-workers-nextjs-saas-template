# Cloudflare Workers SaaS Template

[![.github/workflows/deploy.yml](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml/badge.svg)](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template/actions/workflows/deploy.yml)

# [Live Demo](https://nextjs-saas-template.lubomirgeorgiev.com/sign-up)
# [Github Repo](https://github.com/LubomirGeorgiev/cloudflare-workers-nextjs-saas-template)

This is a SaaS template for Cloudflare Workers. It uses the [OpenNext](https://opennext.js.org/cloudflare) framework to build a SaaS application.

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
- 📨 Email Service with React Email and Resend or Brevo
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
  - 🔍 ESLint Configuration
  - ✨ Prettier Configuration
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

- [ ] Add an eslint rule to check for unused imports and exports
- [ ] Add an eslint rule to check for unused variables and functions
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
2. `pnpx wrangler login` - Login to your Cloudflare account to use Cloudflare AI while testing locally.
3.  Copy `.dev.vars.example` to `.dev.vars` and fill in the values.
4.  Copy `.env.example` to `.env` and fill in the values.
5. `pnpm db:migrate:dev` - Creates a local SQLite database and applies migrations
6. `pnpm db:seed` - Seeds the database with test data
7. `pnpm dev`
8.  Go to https://localhost:3000/sign-in and login with the test user credentials: test@test.com / password
9.  Go to https://localhost:3000/admin to manage users and the CMS.

## Changes to wrangler.jsonc

After making a change to wrangler.jsonc, you need to run `pnpm cf-typegen` to generate the new types.

## Things to change and customize before deploying to production
1. Go to `src/constants.ts` and update it with your project details
2. Update `.cursor/rules/001-main-project-context.mdc` with your project specification so that Cursor AI can give you better suggestions
3. Update the footer in `src/components/footer.tsx` with your project details and links
4. Optional: Update the color palette in `src/app/globals.css`
5. Update the metadata in `src/app/layout.tsx` with your project details

## Deploying to Cloudflare with Github Actions

1. Create D1 and KV namespaces
2. Set either `RESEND_API_KEY` or `BREVO_API_KEY` as a secret in your Cloudflare Worker depending on which email service you want to use. If you are using Brevo go to https://app.brevo.com/security/authorised_ips and disable it.
3. Create a Turnstile catcha in your Cloudflare account, and set the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a Github Actions variable.
4. Set `TURNSTILE_SECRET_KEY` as a secret in your Cloudflare Worker.
5. Update the `wrangler.jsonc` file with the new database and KV namespaces, env variables and account id. Search for "cloudflare-workers-nextjs-saas-template" recursively in the whole repository and change that to the name of your project. Don't forget that the name you choose at the top of the wrangler.jsonc should be the same as `services->[0]->service` in the same file.
6. Go to https://dash.cloudflare.com/profile/api-tokens and click on "Use template" next to "Edit Cloudflare Workers". On the next, page add the following permissions in addition to the ones from the template:
    - Account:AI Gateway:Edit
    - Account:Workers AI:Edit
    - Account:Workers AI:Read
    - Account:Queues:Edit
    - Account:Vectorize:Edit
    - Account:D1:Edit
    - Account:Cloudflare Images:Edit
    - Account:Workers KV Storage:Edit
    - Zone:Cache Purge:Purge
7. Add the API token to the Github repository secrets as `CLOUDFLARE_API_TOKEN`
8. Add the Cloudflare account id to the Github repository variables as `CLOUDFLARE_ACCOUNT_ID`
9. Optional: If you want clear the CDN cache on deploy, add `CLOUDFLARE_ZONE_ID` to the Github repository variables for the zone id of your domain. This is the zone id of your domain, not the account id.
10. Push to the main branch
