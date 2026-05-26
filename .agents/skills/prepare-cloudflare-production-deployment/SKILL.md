---
name: prepare-cloudflare-production-deployment
description: Source-of-truth runbook for preparing this Vinext Cloudflare Workers SaaS template for production deployment. Use when setting up or auditing Cloudflare MCP resources, wrangler.jsonc bindings, Worker secrets, Turnstile, Email Sending, GitHub Actions secrets/variables, or GitHub CLI deployment wiring for this repository.
---

# Prepare Cloudflare Production

## Overview

Use this skill as the source of truth for production deployment. Prefer Cloudflare MCP for Cloudflare account resources and `gh` for GitHub repository secrets/variables; edit repo files directly for project branding, `wrangler.jsonc`, and workflow changes.

Never print secret values. Ask for missing secret values instead of inventing placeholders, and confirm before creating paid, destructive, or externally visible resources.

## Preflight

1. Read `wrangler.jsonc`, `package.json`, `.github/workflows/deploy.yml`, `src/constants.ts`, `src/app/layout.tsx`, `src/components/footer.tsx`, `AGENTS.md`, and `cms.config.ts` when relevant.
2. Check and confirm authenticated accounts before creating, updating, or deleting anything:

```bash
gh auth status
gh repo view --json nameWithOwner,url
```

Use Cloudflare MCP to identify the authenticated Cloudflare account. Tell the user the Cloudflare account id/name/email available from MCP and the GitHub account/repository from `gh`, then ask whether both are correct. Stop if the user says either account is wrong.

3. Confirm or remind the user about the required production customization checklist:
   - `src/constants.ts` has project details.
   - Read `SITE_URL` from `src/constants.ts`, derive the hostname, and check the domains/zones available in the authenticated Cloudflare account. Tell the user which matching or closest Cloudflare zone/domain was found and ask them to confirm it before proceeding. If the `SITE_URL` domain is not available in Cloudflare, stop and ask the user which Cloudflare zone/domain to use or whether they need to add the domain to Cloudflare first.
   - When the app will use Cloudflare Images, verify Images against that same production zone/hostname, not only against the account. Confirm the `SITE_URL` hostname belongs to a Cloudflare zone in the authenticated account and is proxied or attached as the Worker custom domain/route that production will use. Then verify the account-level Images API works for that account with `/accounts/{account_id}/images/v1/variants` or `/accounts/{account_id}/images/v1/stats`. If custom-domain image delivery is expected, explicitly confirm the production zone can serve Images URLs at `https://<SITE_URL_HOSTNAME>/cdn-cgi/imagedelivery/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT_NAME>`; Cloudflare supports this only for customer domains under the same account as the Images account. If the domain is in a different account, not proxied through Cloudflare, or not the domain being deployed to, stop and ask which zone/domain should be used before proceeding.
   - Read `package.json`, tell the user the current `name` value, and ask them to confirm it is the intended production project name. This value controls generated deploy-size metrics and package metadata, so do not proceed if it still identifies the reused template.
   - `AGENTS.md` has the project specification for AI coding agents.
   - `src/components/footer.tsx` has project links and details.
   - `src/app/globals.css` color palette has been reviewed.
   - `src/app/layout.tsx` metadata has project details.
   - `cms.config.ts` has been reviewed and updated if needed.

4. Check local validation tools when deployment-related files change:

```bash
pnpm run check:vinext
pnpm run typecheck
pnpm run build
```

5. Use Cloudflare MCP `search` before `execute` to verify current endpoint shapes for any Cloudflare operation.
6. Collect required inputs:
   - Project name and production domain.
   - Cloudflare account id, or confirm the MCP account id.
   - Zone id if CDN purge or Email Sending domain setup is needed.
   - Sending email address, reply-to address, and sender display name.
   - GitHub repository owner/name if it differs from the current checkout.
   - Secret values: `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY`, and any application secrets such as Stripe or OAuth credentials.

## Automation Map

| Deployment task | Primary tool | Agent handling |
| --- | --- | --- |
| Confirm production customization checklist | File reads and user confirmation | Required before deployment. Remind the user about any unchecked items and update files when they provide project details. |
| Customize `src/constants.ts`, `package.json`, `AGENTS.md`, footer, palette, metadata, `cms.config.ts` | File edits | Automatable after project details are known. |
| Create D1 database | Cloudflare MCP | Automatable with `POST /accounts/{account_id}/d1/database`; update `wrangler.jsonc` with `database_name` and `database_id`. |
| Create KV namespace | Cloudflare MCP | Automatable with `POST /accounts/{account_id}/storage/kv/namespaces`; update `wrangler.jsonc` namespace id. |
| Create R2 bucket | Cloudflare MCP | Automatable with `POST /accounts/{account_id}/r2/buckets`; update `wrangler.jsonc` bucket name. |
| Enable or verify Cloudflare Images | Cloudflare MCP or dashboard | Verify both the account-level Images API and the production `SITE_URL` zone/domain. MCP can list/use Images endpoints under `/accounts/{account_id}/images/v1`; custom-domain delivery requires a proxied/customer domain in the same Cloudflare account as Images, and billing acceptance may still require dashboard interaction. |
| Onboard Email Sending domain | Cloudflare MCP or dashboard | MCP supports Email Sending subdomain create/preview/fix/status endpoints under zones. Domain ownership, DNS propagation, plan gating, or account approval can require waiting or dashboard follow-up. |
| Update email vars and `send_email.allowed_sender_addresses` | File edits | Automatable after sender values are known. |
| Create Turnstile widget | Cloudflare MCP | Automatable with `POST /accounts/{account_id}/challenges/widgets`; set site key as GitHub variable and secret key as Worker secret. |
| Set `TURNSTILE_SECRET_KEY` Worker secret | Cloudflare MCP or Wrangler | Automatable through Worker Script secrets API after the Worker script exists, or with `wrangler secret put`. |
| Update `wrangler.jsonc` account id, bindings, vars, and project name | File edits | Automatable. Run `pnpm run cf-typegen` if bindings change. |
| Create Cloudflare API token | Cloudflare dashboard and `gh` | Always ask the user to create/provide the token manually. Store the provided token in GitHub Actions with `gh`; do not try to create API tokens through Cloudflare MCP. |
| Add `CLOUDFLARE_API_TOKEN` GitHub secret | `gh` | Automatable with `gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO`. |
| Add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` GitHub variables | `gh` | Automatable with `gh variable set NAME --body VALUE --repo OWNER/REPO`. |
| Push to `main` and deploy | Git and GitHub Actions | Automatable only after user approval for push/deploy. Use `gh run list`, `gh run watch`, and `gh run view --log-failed` to monitor. |

## Cloudflare MCP Patterns

Use idempotent create-or-reuse behavior:

1. List existing resources by name.
2. Reuse exact matches.
3. Create only when missing and the user has approved the final names.
4. Store returned ids in `wrangler.jsonc`.

Common endpoint families to search and use:

```text
Zones/domains: /zones
D1: /accounts/{account_id}/d1/database
KV: /accounts/{account_id}/storage/kv/namespaces
R2: /accounts/{account_id}/r2/buckets
Turnstile: /accounts/{account_id}/challenges/widgets
Worker secrets: /accounts/{account_id}/workers/scripts/{script_name}/secrets
API tokens: /accounts/{account_id}/tokens
Email Sending: /zones/{zone_id}/email/sending/subdomains
Images: /accounts/{account_id}/images/v1
Images variants and stats: /accounts/{account_id}/images/v1/variants, /accounts/{account_id}/images/v1/stats
Images custom-domain delivery check: resolve SITE_URL hostname to a same-account zone, then verify or document delivery through https://<hostname>/cdn-cgi/imagedelivery/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT_NAME>
Cache purge: /zones/{zone_id}/purge_cache
```

When a Cloudflare step is blocked by billing, product enablement, token permissions, DNS propagation, or account approval, report the exact blocker and give the smallest dashboard action needed.

## Secret Handling

Do not print secret values in chat, logs, diffs, or command output. Prefer piping secret values directly into the destination tool.

`CLOUDFLARE_API_TOKEN`:

1. Apologize to the user that, unfortunately, Cloudflare API token creation is not supported by the current Cloudflare MCP workflow. Always ask the user to create/provide this token manually. Do not try to create, roll, or retrieve Cloudflare API tokens through Cloudflare MCP.
2. Send the user to `https://dash.cloudflare.com/profile/api-tokens`.
3. Tell them to click **Use template** next to **Edit Cloudflare Workers**.
4. Tell them to add these permissions in addition to the template defaults:
   - `Account:AI Gateway:Edit`
   - `Account:Workers AI:Edit`
   - `Account:Workers AI:Read`
   - `Account:Queues:Edit`
   - `Account:Vectorize:Edit`
   - `Account:D1:Edit`
   - `Account:Cloudflare Images:Edit`
   - `Account:Workers KV Storage:Edit`
   - `Account:Email Sending:Edit`
   - `Zone:Cache Purge:Purge`
5. Tell them to scope the token to the intended Cloudflare account and, when zone permissions are needed, the intended production zone.
6. After they provide the token, add it to GitHub Actions without printing it:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO
```

Paste the token only into the secure `gh` prompt. Verify the secret exists with:

```bash
gh secret list --repo OWNER/REPO
```

`TURNSTILE_SECRET_KEY`:

1. Cloudflare MCP can retrieve the secret from a Turnstile widget details response, create a new widget and capture its secret, or rotate a widget secret after user confirmation.
2. Prefer reusing the intended existing widget when the domain/name matches. Create or rotate only after confirming with the user, because rotating can invalidate production captcha verification.
3. Set the Turnstile site key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in GitHub repository variables and set the secret key as `TURNSTILE_SECRET_KEY` in Worker secrets.

## GitHub CLI Patterns

Prefer `gh` for repository configuration:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO
gh variable set CLOUDFLARE_ACCOUNT_ID --body "$ACCOUNT_ID" --repo OWNER/REPO
gh variable set CLOUDFLARE_ZONE_ID --body "$ZONE_ID" --repo OWNER/REPO
gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --body "$SITE_KEY" --repo OWNER/REPO
gh variable set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --body "$STRIPE_KEY" --repo OWNER/REPO
gh secret list --repo OWNER/REPO
gh variable list --repo OWNER/REPO
```

Use `gh secret set` from stdin or an environment variable when handling sensitive values. Do not place secrets in shell history or command output.

Set any required `NEXT_PUBLIC_*` values as GitHub Actions variables with `gh variable set`. The deploy workflow auto-forwards matching variables, so do not add individual `NEXT_PUBLIC_*` entries to `.github/workflows/deploy.yml`.

## Repository Edits

Apply the repo rules from `AGENTS.md`:

1. Keep Vinext commands; do not reintroduce legacy Next.js or OpenNext deploy paths.
2. Update `wrangler.jsonc`, not `worker-configuration.d.ts`; run `pnpm run cf-typegen` after binding changes.
3. Preserve existing comments unless they are stale.
4. For form or app-specific secrets not mentioned in the README, inspect `.github/workflows/deploy.yml`, `src/flags.ts`, and integrations before deciding which GitHub variables/secrets are needed.
5. Run `pnpm run check:vinext`, `pnpm run typecheck`, and `pnpm run build` when deployment-related files change and time permits.

## Deployment Verification

After configuration:

1. Run local checks:

```bash
pnpm run lint
pnpm run typecheck
pnpm run check:vinext
pnpm run build
```

2. If deploying through GitHub Actions, monitor the workflow:

```bash
gh run list --workflow deploy.yml --limit 5
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log-failed
```

3. Confirm remote D1 migrations ran, the Worker deployed, optional cache purge succeeded, and deploy-size metrics were committed or intentionally skipped.
