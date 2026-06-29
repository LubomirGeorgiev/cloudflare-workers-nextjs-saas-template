---
name: prepare-cloudflare-production-deployment
description: Source-of-truth runbook for preparing this Vinext Cloudflare Workers SaaS template for production deployment. Use when setting up or auditing Cloudflare MCP resources, wrangler.jsonc bindings, Worker secrets, Turnstile, Email Sending, GitHub Actions secrets/variables, or GitHub CLI deployment wiring for this repository.
---

# Prepare Cloudflare Production

## Overview

Use this skill as the source of truth for production deployment. Cloudflare MCP must be used for Cloudflare account/resource discovery, verification, and supported mutations before using Wrangler, raw API calls, dashboard instructions, or assumptions. Use `gh` for GitHub repository secrets/variables; edit repo files directly for project branding, `wrangler.jsonc`, and workflow changes.

Never print secret values. Ask for missing secret values instead of inventing placeholders, and confirm before creating paid, destructive, or externally visible resources.

## Preflight

1. Read `wrangler.jsonc`, `package.json`, `.github/workflows/deploy.yml`, `src/constants.ts`, `src/app/layout.tsx`, `src/components/footer.tsx`, `AGENTS.md`, and `cms.config.ts` when relevant.
2. Check GitHub auth, then complete the `MCP availability gate` before any Cloudflare mutation:

```bash
gh auth status
gh repo view --json nameWithOwner,url
```

Report the Cloudflare account id/name/email from MCP and the GitHub account/repository from `gh`, then ask whether both are correct. Stop if the user says either account is wrong.

3. Confirm or remind the user about the required production customization checklist:
   - `src/constants.ts` has project details.
   - Read `SITE_URL` from `src/constants.ts`, derive the hostname, and check the domains/zones available in the authenticated Cloudflare account. Tell the user which matching or closest Cloudflare zone/domain was found and ask them to confirm it before proceeding. If the `SITE_URL` domain is not available in Cloudflare, stop and ask the user which Cloudflare zone/domain to use or whether they need to add the domain to Cloudflare first.
   - When the app will use Cloudflare Images, verify Images against that same production zone/hostname, not only against the account. Confirm the `SITE_URL` hostname belongs to a Cloudflare zone in the authenticated account and is proxied or attached as the Worker custom domain/route that production will use. Then verify the account-level Images API works for that account with `/accounts/{account_id}/images/v1/variants` or `/accounts/{account_id}/images/v1/stats`. If custom-domain image delivery is expected, explicitly confirm the production zone can serve Images URLs at `https://<SITE_URL_HOSTNAME>/cdn-cgi/imagedelivery/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT_NAME>`; Cloudflare supports this only for customer domains under the same account as the Images account. If the domain is in a different account, not proxied through Cloudflare, or not the domain being deployed to, stop and ask which zone/domain should be used before proceeding.
   - Read `package.json`, tell the user the current `name` value, and ask them to confirm it is the intended production project name. This value controls generated deploy-size metrics and package metadata, so do not proceed if it still identifies the reused template. If the name is still `cloudflare-workers-nextjs-saas-template`, stop and ask the user for the real project name and production domain before editing Cloudflare resources, queue names, bindings, or deployment metadata.
   - Check queue names in `wrangler.jsonc`, especially `queues.producers[].queue` and `queues.consumers[].queue`. Queue names must be renamed to match the new production project name; do not leave template queue names such as `cloudflare-workers-nextjs-saas-template-scheduler` in a production project unless the user explicitly confirms that is the real project name.
   - Email Sending must follow the `Email Sending` procedure below: use the production `SITE_URL` zone, expect `notifications.<SITE_URL_HOSTNAME>`, and get user confirmation before Cloudflare or `wrangler.jsonc` changes.
   - `AGENTS.md` has the project specification for AI coding agents.
   - `src/components/footer.tsx` has project links and details.
   - `src/app/globals.css` color palette has been reviewed.
   - `src/app/layout.tsx` metadata has project details.
   - `cms.config.ts` has been reviewed and updated if needed.

4. Collect required inputs:
   - Project name and production domain.
   - Confirmed Cloudflare account id and production zone id.
   - Sending email address, reply-to address, and sender display name.
   - GitHub repository owner/name if it differs from the current checkout.
   - Required values from `Required configuration buckets`.
5. Follow `Deployment Verification` after deployment-related file or runtime configuration changes.

## Automation Map

| Deployment task | Primary tool | Agent handling |
| --- | --- | --- |
| Confirm production customization checklist | File reads and user confirmation | Required before deployment. Remind the user about any unchecked items and update files when they provide project details. |
| Customize `src/constants.ts`, `package.json`, `AGENTS.md`, footer, palette, metadata, `cms.config.ts` | File edits | Automatable after project details are known. |
| Create D1, KV, R2, or Queue resources | Cloudflare MCP | Use MCP patterns below: list by final production name, reuse exact matches, create only when approved, and write returned ids/names to `wrangler.jsonc`. Queue names must use the final project name. |
| Enable or verify Cloudflare Images | Cloudflare MCP | Verify both the account-level Images API and the production `SITE_URL` zone/domain. Billing acceptance may still require dashboard interaction. |
| Verify/onboard Email Sending and update sender config | Cloudflare MCP and file edits | Follow `Email Sending`. Verify the production-zone subdomain before file edits, and edit sender values only after user confirmation. |
| Create/update Turnstile widget | Cloudflare MCP, then dashboard if blocked | Follow the `TURNSTILE_SECRET_KEY` section: verify domains before reuse, preserve existing widget settings, and put site key/secret in the correct configuration buckets. |
| Update `wrangler.jsonc` account id, bindings, vars, and project name | File edits | Automatable. Run `pnpm run cf-typegen` if bindings change. |
| Configure GitHub and Worker secrets/variables | `gh`, Cloudflare MCP, or `wrangler.jsonc` | Follow `Required configuration buckets`. GitHub Actions config and Worker runtime config are separate. |
| Push to `main` and deploy | Git and GitHub Actions | Automatable only after user approval for push/deploy. Use `gh run list`, `gh run watch`, and `gh run view --log-failed` to monitor. |

## Cloudflare MCP Patterns

Cloudflare MCP is not optional for Cloudflare operations. Always try it first for account/resource reads and supported writes. Wrangler, raw `curl`, and dashboard instructions are fallback paths only.

### MCP availability gate

At the start of deployment prep, before any Cloudflare mutation:

1. Confirm Cloudflare MCP tools are installed/available in the current session.
2. Confirm Cloudflare MCP can identify the authenticated Cloudflare account.
3. Report the Cloudflare account id/name/email from MCP to the user.
4. If MCP is missing, not logged in, or cannot identify the account, warn the user and pause Cloudflare resource changes. The warning must include:
   - Which MCP capability is missing or failing.
   - That Wrangler/raw API/dashboard fallback can diverge from the required MCP-audited workflow.
   - The smallest next action: install/enable Cloudflare MCP, log in to Cloudflare MCP, or explicitly approve a fallback.

Only continue with Wrangler/raw API/dashboard fallback after the user explicitly approves that fallback or MCP cannot support the needed product operation.

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
Queues: /accounts/{account_id}/queues
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

Do not print secret values in chat, logs, diffs, or command output. Secret creation/provisioning is a user-only manual step unless the secret is returned by an explicitly approved product API flow, such as creating a new Turnstile widget. Prefer secure prompts and never invent placeholders.

### Required configuration buckets

Before pushing or deploying through GitHub Actions, explicitly tell the user which values belong in each bucket and whether they already exist:

1. **GitHub Actions secrets** are available only to the GitHub workflow. For the current deploy workflow, the required secret is `CLOUDFLARE_API_TOKEN`; the user must create/provide it manually and paste it into the secure `gh` prompt.
2. **GitHub Actions variables** are non-secret values available to the GitHub workflow. Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, enabled `NEXT_PUBLIC_*` values, and remember the deploy workflow auto-forwards repository `NEXT_PUBLIC_*` variables into the build.
3. **Worker runtime secrets** are available to the deployed Worker, not to GitHub Actions. Ask the user to supply enabled-feature secrets such as `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY`, `STRIPE_SECRET_KEY`, and `GOOGLE_CLIENT_SECRET` through secure prompts or supported MCP secret writes.
4. **Worker runtime variables** are non-secret values available to the deployed Worker. Prefer stable project/account values such as `CLOUDFLARE_ACCOUNT_ID` and `GOOGLE_CLIENT_ID` in `wrangler.jsonc` under `vars`; otherwise use Cloudflare MCP/dashboard/API.

After setting repository configuration, verify without exposing values:

```bash
gh secret list --repo OWNER/REPO
gh variable list --repo OWNER/REPO
```

After setting Worker secrets, verify behavior by exercising the relevant feature or checking the Worker dashboard secret names. Do not attempt to read secret values back.

`CLOUDFLARE_API_TOKEN`:

1. Apologize to the user that, unfortunately, Cloudflare API token creation is not supported by the current Cloudflare MCP workflow. Always ask the user to create/provide this token manually. Do not try to create, roll, retrieve, guess, or reuse Cloudflare API tokens through Cloudflare MCP/API or repository history.
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
   - `Account:Turnstile Sites:Edit` or `Account:Turnstile Sites:Read` plus dashboard access if only reading existing widgets
   - `Zone:Cache Purge:Purge`
5. Tell them to scope the token to the intended Cloudflare account and, when zone permissions are needed, the intended production zone.
6. Tell the user this token is used in two contexts:
   - GitHub Actions uses `CLOUDFLARE_API_TOKEN` for deploy, D1 migrations, and cache purge.
   - The deployed Worker uses `CLOUDFLARE_API_TOKEN` for the admin scheduled jobs page to preview Cloudflare Queue payloads. Native Queue binding metrics do not need this token, but payload preview does.
7. After they provide the token, add it to GitHub Actions without printing it:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO
```

Paste the token only into the secure `gh` prompt. Verify the secret exists with:

```bash
gh secret list --repo OWNER/REPO
```

8. Also set the token as a Worker secret for runtime admin Queue preview:

```bash
pnpm wrangler secret put CLOUDFLARE_API_TOKEN
```

`CLOUDFLARE_ACCOUNT_ID`:

1. Set `CLOUDFLARE_ACCOUNT_ID` as a GitHub Actions variable for deploy/migrations:

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID --body "$ACCOUNT_ID" --repo OWNER/REPO
```

2. Also make `CLOUDFLARE_ACCOUNT_ID` available to the deployed Worker runtime for admin Queue preview. Prefer adding it to `wrangler.jsonc` under `vars` when the account id is stable for the project, or set it as a Worker variable through the Cloudflare dashboard/API. Do not treat the account id as a secret, but do verify it matches the account used by `wrangler.jsonc`.

`TURNSTILE_SECRET_KEY`:

1. First determine whether Turnstile is enabled by inspecting `src/flags.ts`, forms using `src/components/captcha.tsx`, and the presence of `TURNSTILE_SECRET_KEY` in the target environment. If disabled, say the Turnstile values are optional until the feature is enabled.
2. Prefer reusing an intended existing widget only when its name and allowed domains match the production hostname. Do not copy a site key from another repo or environment unless the user confirms the widget is intended for the new production hostname.
3. If Cloudflare MCP/API execution is available, use docs search before execute, then list/inspect/update widgets through `/accounts/{account_id}/challenges/widgets`. Preserve existing widget settings and domains; add the production hostname only after user confirmation because this changes an externally visible security control.

4. If Cloudflare MCP/API execution is not available or the token lacks Turnstile permissions, this is a user-only manual step. Do not keep retrying with Wrangler or unrelated APIs. Tell the user that the active Cloudflare MCP/API token needs `Turnstile Sites Write` or `Account Settings Write` to update widgets automatically; without that permission, they must add the hostname manually in the dashboard:
   - Open `https://dash.cloudflare.com/?to=/:account/turnstile`.
   - Select the existing widget by sitekey, for example `0x4AAAAAAA5QtwiAltpKMppM`, or click **Add widget** if creating a new one.
   - Go to **Settings** and **Hostname Management**.
   - Set the widget name to the project or production hostname.
   - Add the production hostname from `SITE_URL`, for example `test-nextjs-saas-template.lubomirgeorgiev.com`.
   - Preserve any existing allowed hostnames unless the user explicitly wants to remove them.
   - Use **Managed** mode unless the user requests another mode.
   - Copy the public **sitekey** and private **secret key**.
5. Set the public sitekey as a GitHub repository variable so GitHub Actions can inject it into the production build:

```bash
gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --body "$TURNSTILE_SITE_KEY" --repo OWNER/REPO
gh variable list --repo OWNER/REPO
```

6. Set the private secret key as a Worker runtime secret. Ask the user to paste the value into the secure Wrangler prompt; never print it:

```bash
pnpm wrangler secret put TURNSTILE_SECRET_KEY
```

7. If a new widget was created or an existing widget secret was rotated, remind the user that any old `TURNSTILE_SECRET_KEY` stops working for that widget once rotation takes effect.

`STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`:

1. Ask the user whether credit billing is enabled before requiring Stripe values.
2. If enabled, set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` as a GitHub repository variable so the production build receives it.
3. Set `STRIPE_SECRET_KEY` as a Worker runtime secret with `pnpm wrangler secret put STRIPE_SECRET_KEY`. Do not add Stripe secret keys to GitHub Actions secrets unless the workflow is explicitly changed to sync them into Worker secrets.

### Email Sending

1. Derive `SITE_URL_HOSTNAME` from `src/constants.ts` and the expected sending subdomain `notifications.<SITE_URL_HOSTNAME>`.
2. Use Cloudflare MCP on the **production** zone id for `SITE_URL_HOSTNAME` to list `/zones/{zone_id}/email/sending/subdomains`. Confirm `notifications.<SITE_URL_HOSTNAME>` exists and is enabled. Do not assume a subdomain on a different zone (for example the template's old domain) satisfies production requirements.
3. Read current `wrangler.jsonc` email settings: `vars.EMAIL_FROM`, `vars.EMAIL_FROM_NAME`, `vars.EMAIL_REPLY_TO`, and `send_email[].allowed_sender_addresses`.
4. **Ask the user to confirm** the intended production email settings before any mutation. Present:
   - Sending subdomain: `notifications.<SITE_URL_HOSTNAME>`
   - From address: typically `no-reply@notifications.<SITE_URL_HOSTNAME>`
   - From display name
   - Reply-to address
   - Allowed sender addresses
   Stop if the user has not confirmed these values.
5. If the sending subdomain is missing, create it on the production zone with Cloudflare MCP (`POST /zones/{zone_id}/email/sending/subdomains` with `{ "name": "notifications.<SITE_URL_HOSTNAME>" }`), then use preview/fix/status endpoints until DNS is healthy.
6. After user confirmation, update `wrangler.jsonc`:
   - `vars.EMAIL_FROM`
   - `vars.EMAIL_FROM_NAME`
   - `vars.EMAIL_REPLY_TO`
   - `send_email[].allowed_sender_addresses` to include `EMAIL_FROM`
7. Run `pnpm run cf-typegen` after `wrangler.jsonc` email var changes.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`:

1. Ask the user whether Google SSO is enabled before requiring Google OAuth values.
2. If enabled, instruct the user to create or select the OAuth client manually in Google Cloud Console. The agent must not invent OAuth credentials or scrape secret values from chat/logs/history.
3. Tell the user to configure the Google OAuth redirect URI for the production domain, for example `https://<SITE_URL_HOSTNAME>/sso/google/callback`.
4. Set `GOOGLE_CLIENT_ID` as a Worker runtime variable, preferably under `vars` in `wrangler.jsonc` for stable project config. This value is not secret, but the user should still confirm it belongs to the intended Google OAuth client.
5. Set `GOOGLE_CLIENT_SECRET` as a Worker runtime secret with `pnpm wrangler secret put GOOGLE_CLIENT_SECRET`. The user must paste the secret manually into the secure Wrangler prompt; never print it in chat.

## GitHub CLI Patterns

Prefer `gh` for repository secrets/variables. Use `gh secret set` from stdin or an environment variable when handling sensitive values, and do not place secrets in shell history or command output. Do not add individual `NEXT_PUBLIC_*` entries to `.github/workflows/deploy.yml`; the deploy workflow already forwards repository variables with that prefix.

## Repository Edits

Apply the repo rules from `AGENTS.md`:

1. Keep Vinext commands; do not reintroduce legacy Next.js or OpenNext deploy paths.
2. Update `wrangler.jsonc`, not `worker-configuration.d.ts`; run `pnpm run cf-typegen` after binding changes.
3. Preserve existing comments unless they are stale.
4. For form or app-specific secrets not mentioned in the README, inspect `.github/workflows/deploy.yml`, `src/flags.ts`, and integrations before deciding which GitHub variables/secrets are needed.
5. Follow `Deployment Verification` when deployment-related files change and time permits.

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
