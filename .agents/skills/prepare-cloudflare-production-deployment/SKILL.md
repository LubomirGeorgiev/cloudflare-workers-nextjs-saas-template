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
2. Check and confirm authenticated accounts before creating, updating, or deleting anything:

```bash
gh auth status
gh repo view --json nameWithOwner,url
```

Before using Wrangler, raw API calls, or dashboard instructions for any Cloudflare task, check whether Cloudflare MCP is installed, available in the current tool context, and authenticated. Use the Cloudflare MCP account/profile capability if available; otherwise use tool discovery/MCP resource discovery to verify whether Cloudflare MCP tools are present. If Cloudflare MCP is missing, unavailable, unauthenticated, or cannot identify the active account, warn the user explicitly and stop before creating/updating Cloudflare resources unless the user approves a fallback path. The warning must say what is missing and why deployment automation is less safe without MCP.

Use Cloudflare MCP to identify the authenticated Cloudflare account. Tell the user the Cloudflare account id/name/email available from MCP and the GitHub account/repository from `gh`, then ask whether both are correct. Stop if the user says either account is wrong.

3. Confirm or remind the user about the required production customization checklist:
   - `src/constants.ts` has project details.
   - Read `SITE_URL` from `src/constants.ts`, derive the hostname, and check the domains/zones available in the authenticated Cloudflare account. Tell the user which matching or closest Cloudflare zone/domain was found and ask them to confirm it before proceeding. If the `SITE_URL` domain is not available in Cloudflare, stop and ask the user which Cloudflare zone/domain to use or whether they need to add the domain to Cloudflare first.
   - When the app will use Cloudflare Images, verify Images against that same production zone/hostname, not only against the account. Confirm the `SITE_URL` hostname belongs to a Cloudflare zone in the authenticated account and is proxied or attached as the Worker custom domain/route that production will use. Then verify the account-level Images API works for that account with `/accounts/{account_id}/images/v1/variants` or `/accounts/{account_id}/images/v1/stats`. If custom-domain image delivery is expected, explicitly confirm the production zone can serve Images URLs at `https://<SITE_URL_HOSTNAME>/cdn-cgi/imagedelivery/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT_NAME>`; Cloudflare supports this only for customer domains under the same account as the Images account. If the domain is in a different account, not proxied through Cloudflare, or not the domain being deployed to, stop and ask which zone/domain should be used before proceeding.
   - Read `package.json`, tell the user the current `name` value, and ask them to confirm it is the intended production project name. This value controls generated deploy-size metrics and package metadata, so do not proceed if it still identifies the reused template. If the name is still `cloudflare-workers-nextjs-saas-template`, stop and ask the user for the real project name and production domain before editing Cloudflare resources, queue names, bindings, or deployment metadata.
   - Check queue names in `wrangler.jsonc`, especially `queues.producers[].queue` and `queues.consumers[].queue`. Queue names must be renamed to match the new production project name; do not leave template queue names such as `cloudflare-workers-nextjs-saas-template-scheduler` in a production project unless the user explicitly confirms that is the real project name.
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

5. Use Cloudflare MCP for every Cloudflare operation it supports:
   - First verify Cloudflare MCP is installed/available and authenticated. If not, warn the user and do not proceed with Cloudflare resource mutation until they install/login to Cloudflare MCP or explicitly approve a fallback.
   - Use Cloudflare MCP to list/read current account, zone, Worker, D1, KV, R2, Queue, Turnstile, Images, Email Sending, and Worker secret/runtime configuration before creating or updating anything.
   - Use Cloudflare MCP `search` before `execute` to verify current endpoint shapes for any Cloudflare operation.
   - Use Cloudflare MCP `execute` or the matching Cloudflare MCP mutation tool for supported creates/updates/deletes.
   - Do not fall back to Wrangler, raw `curl`, or dashboard instructions until Cloudflare MCP is unavailable, lacks the needed endpoint, lacks permission, or the product explicitly requires dashboard/manual action.
   - If falling back, say exactly why MCP could not perform that operation.
6. Collect required inputs:
   - Project name and production domain.
   - Cloudflare account id, or confirm the MCP account id.
   - Zone id if CDN purge or Email Sending domain setup is needed.
   - Sending email address, reply-to address, and sender display name.
   - GitHub repository owner/name if it differs from the current checkout.
   - GitHub Actions secret values: `CLOUDFLARE_API_TOKEN`. The user must create/provide this manually; the agent must not try to create, retrieve, or invent it.
   - GitHub Actions public variables: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and any other `NEXT_PUBLIC_*` values used by enabled features.
   - Worker runtime secret values: `CLOUDFLARE_API_TOKEN`, `TURNSTILE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, and any other server-only application secrets used by enabled features. The user must provide OAuth/API secrets manually through secure prompts or dashboards.
   - Worker runtime non-secret variables: `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_CLIENT_ID`, and any other server-side public IDs used by enabled features.
   - Remind the user that GitHub Actions secrets/variables are not automatically Worker runtime secrets/variables. The user must add secrets manually because agents must not create, invent, retrieve, or print secret values such as `CLOUDFLARE_API_TOKEN` or Google OAuth secrets.

## Automation Map

| Deployment task | Primary tool | Agent handling |
| --- | --- | --- |
| Confirm production customization checklist | File reads and user confirmation | Required before deployment. Remind the user about any unchecked items and update files when they provide project details. |
| Customize `src/constants.ts`, `package.json`, `AGENTS.md`, footer, palette, metadata, `cms.config.ts` | File edits | Automatable after project details are known. |
| Create D1 database | Cloudflare MCP | Cloudflare MCP is mandatory first. Automatable with `POST /accounts/{account_id}/d1/database`; update `wrangler.jsonc` with `database_name` and `database_id`. |
| Create KV namespace | Cloudflare MCP | Cloudflare MCP is mandatory first. Automatable with `POST /accounts/{account_id}/storage/kv/namespaces`; update `wrangler.jsonc` namespace id. |
| Create R2 bucket | Cloudflare MCP | Cloudflare MCP is mandatory first. Automatable with `POST /accounts/{account_id}/r2/buckets`; update `wrangler.jsonc` bucket name. |
| Create Queue resources | Cloudflare MCP | Cloudflare MCP is mandatory first. Automatable after the final project name is known. Queue names in `wrangler.jsonc` must match the production project name, for example `<project-name>-scheduler`; if the project name is still `cloudflare-workers-nextjs-saas-template`, ask for the real project name and production domain first. Use Wrangler only if Cloudflare MCP cannot perform the Queue operation and explain why. |
| Enable or verify Cloudflare Images | Cloudflare MCP | Cloudflare MCP is mandatory first. Verify both the account-level Images API and the production `SITE_URL` zone/domain. MCP can list/use Images endpoints under `/accounts/{account_id}/images/v1`; custom-domain delivery requires a proxied/customer domain in the same Cloudflare account as Images, and billing acceptance may still require dashboard interaction. |
| Onboard Email Sending domain | Cloudflare MCP | Cloudflare MCP is mandatory first. MCP supports Email Sending subdomain create/preview/fix/status endpoints under zones. Domain ownership, DNS propagation, plan gating, or account approval can require waiting or dashboard follow-up. |
| Update email vars and `send_email.allowed_sender_addresses` | File edits | Automatable after sender values are known. |
| Create/update Turnstile widget | Cloudflare MCP, then dashboard if blocked | Cloudflare MCP is mandatory first. Automatable with `/accounts/{account_id}/challenges/widgets`; set site key as GitHub variable and secret key as Worker secret. When reusing a widget, Cloudflare MCP must verify and, with user confirmation, add the production hostname to the widget domains if missing. If MCP returns an authentication/permission error for Turnstile, tell the user they must add the hostname manually in the Cloudflare Turnstile dashboard. |
| Set `TURNSTILE_SECRET_KEY` Worker secret | Cloudflare MCP | Cloudflare MCP is mandatory first. Automatable through Worker Script secrets API after the Worker script exists. Use `wrangler secret put` only if MCP cannot set Worker secrets and explain why. |
| Update `wrangler.jsonc` account id, bindings, vars, and project name | File edits | Automatable. Run `pnpm run cf-typegen` if bindings change. |
| Create Cloudflare API token | Cloudflare dashboard and `gh` | User-only manual step. Always ask the user to create/provide the token manually. Store the provided token in GitHub Actions with `gh`; do not try to create, retrieve, or invent API tokens through Cloudflare MCP/API. |
| Add `CLOUDFLARE_API_TOKEN` GitHub secret | `gh` | Automatable with `gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO`. This powers deployment, migrations, and cache purge in GitHub Actions. |
| Add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and other `NEXT_PUBLIC_*` GitHub variables | `gh` | Automatable with `gh variable set NAME --body VALUE --repo OWNER/REPO`. `CLOUDFLARE_ACCOUNT_ID` powers GitHub Actions and should match the account used by `wrangler.jsonc`. |
| Set Worker runtime Cloudflare API credentials | Cloudflare MCP | Cloudflare MCP is mandatory first. Required for the admin scheduled jobs page to preview Cloudflare Queue payloads. Set `CLOUDFLARE_ACCOUNT_ID` as a Worker variable and `CLOUDFLARE_API_TOKEN` as a Worker secret for the deployed Worker. |
| Set Worker runtime app secrets | Cloudflare MCP | Cloudflare MCP is mandatory first for writing secrets after the user manually supplies values through a secure prompt/process. Required for production app features. Ask the user to manually enter `TURNSTILE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `GOOGLE_CLIENT_SECRET`, and any other server-only secrets used by enabled features; never print values. Use Wrangler/dashboard only if MCP cannot set the secret and explain why. |
| Set Worker runtime app variables | Cloudflare MCP or `wrangler.jsonc` vars | Cloudflare MCP is mandatory first for runtime variables not committed to `wrangler.jsonc`. Add stable non-secret values such as `GOOGLE_CLIENT_ID` to `wrangler.jsonc` vars when appropriate, or use MCP/dashboard/API for runtime-only variables. Run `pnpm run cf-typegen` after config changes. |
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

1. **GitHub Actions secrets** are available only to the GitHub workflow. For the current deploy workflow, the required secret is `CLOUDFLARE_API_TOKEN`. The user must create/provide this token manually in Cloudflare and paste it into the secure `gh` prompt:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo OWNER/REPO
```

2. **GitHub Actions variables** are non-secret values available to the GitHub workflow. The deploy workflow forwards all `NEXT_PUBLIC_*` repository variables into the build, so set enabled public feature keys here:

```bash
gh variable set CLOUDFLARE_ACCOUNT_ID --body "$ACCOUNT_ID" --repo OWNER/REPO
gh variable set CLOUDFLARE_ZONE_ID --body "$ZONE_ID" --repo OWNER/REPO
gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --body "$TURNSTILE_SITE_KEY" --repo OWNER/REPO
gh variable set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --body "$STRIPE_PUBLISHABLE_KEY" --repo OWNER/REPO
```

3. **Worker runtime secrets** are available to the deployed Worker, not to GitHub Actions. Ask the user to paste these manually into secure Wrangler prompts for enabled features. In particular, `CLOUDFLARE_API_TOKEN` and `GOOGLE_CLIENT_SECRET` must be supplied by the user; do not attempt to retrieve or generate them:

```bash
pnpm wrangler secret put CLOUDFLARE_API_TOKEN
pnpm wrangler secret put TURNSTILE_SECRET_KEY
pnpm wrangler secret put STRIPE_SECRET_KEY
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
```

4. **Worker runtime variables** are non-secret values available to the deployed Worker. Prefer stable project/account values in `wrangler.jsonc` under `vars`; otherwise use the Cloudflare dashboard/API. Common values:

```text
CLOUDFLARE_ACCOUNT_ID
GOOGLE_CLIENT_ID
```

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
3. If Cloudflare MCP/API execution is available, use the Turnstile widget API to list widgets and inspect the matching widget. Use Cloudflare docs search before execute to confirm the endpoint shape:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/challenges/widgets" \
  --request GET \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/challenges/widgets/$SITEKEY" \
  --request GET \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

4. If an existing widget is correct but missing the production hostname, update it only after user confirmation because this changes an externally visible security control:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/challenges/widgets/$SITEKEY" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "name": "<WIDGET_NAME>",
    "domains": ["<SITE_URL_HOSTNAME>"],
    "mode": "managed"
  }'
```

Preserve existing widget settings and domains when updating; do not replace the `domains` list with only the new hostname unless the user explicitly wants that.

5. If Cloudflare MCP/API execution is not available or the token lacks Turnstile permissions, this is a user-only manual step. Do not keep retrying with Wrangler or unrelated APIs. Tell the user that the active Cloudflare MCP/API token needs `Turnstile Sites Write` or `Account Settings Write` to update widgets automatically; without that permission, they must add the hostname manually in the dashboard:
   - Open `https://dash.cloudflare.com/?to=/:account/turnstile`.
   - Select the existing widget by sitekey, for example `0x4AAAAAAA5QtwiAltpKMppM`, or click **Add widget** if creating a new one.
   - Go to **Settings** and **Hostname Management**.
   - Set the widget name to the project or production hostname.
   - Add the production hostname from `SITE_URL`, for example `test-nextjs-saas-template.lubomirgeorgiev.com`.
   - Preserve any existing allowed hostnames unless the user explicitly wants to remove them.
   - Use **Managed** mode unless the user requests another mode.
   - Copy the public **sitekey** and private **secret key**.
6. Set the public sitekey as a GitHub repository variable so GitHub Actions can inject it into the production build:

```bash
gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --body "$TURNSTILE_SITE_KEY" --repo OWNER/REPO
gh variable list --repo OWNER/REPO
```

7. Set the private secret key as a Worker runtime secret. Ask the user to paste the value into the secure Wrangler prompt; never print it:

```bash
pnpm wrangler secret put TURNSTILE_SECRET_KEY
```

8. If a new widget was created or an existing widget secret was rotated, remind the user that any old `TURNSTILE_SECRET_KEY` stops working for that widget once rotation takes effect.

`STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`:

1. Ask the user whether credit billing is enabled before requiring Stripe values.
2. If enabled, set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` as a GitHub repository variable so the production build receives it.
3. Set `STRIPE_SECRET_KEY` as a Worker runtime secret with `pnpm wrangler secret put STRIPE_SECRET_KEY`. Do not add Stripe secret keys to GitHub Actions secrets unless the workflow is explicitly changed to sync them into Worker secrets.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`:

1. Ask the user whether Google SSO is enabled before requiring Google OAuth values.
2. If enabled, instruct the user to create or select the OAuth client manually in Google Cloud Console. The agent must not invent OAuth credentials or scrape secret values from chat/logs/history.
3. Tell the user to configure the Google OAuth redirect URI for the production domain, for example `https://<SITE_URL_HOSTNAME>/sso/google/callback`.
4. Set `GOOGLE_CLIENT_ID` as a Worker runtime variable, preferably under `vars` in `wrangler.jsonc` for stable project config. This value is not secret, but the user should still confirm it belongs to the intended Google OAuth client.
5. Set `GOOGLE_CLIENT_SECRET` as a Worker runtime secret with `pnpm wrangler secret put GOOGLE_CLIENT_SECRET`. The user must paste the secret manually into the secure Wrangler prompt; never print it in chat.

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

Remember that GitHub Actions secrets/variables are not automatically Worker runtime secrets/variables. If the admin scheduled jobs page should preview Cloudflare Queue payloads in production, ensure the deployed Worker also has `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` configured at runtime. If Turnstile, Stripe, or Google SSO are enabled, ensure their Worker runtime secrets/variables are set before testing those features.

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
