# Cursor Cloud environment

Standard install, DB, test, lint, build, and run commands are in `README.md` and `package.json`.
Below are only the non-obvious caveats for this environment.

## Node version (critical)

- The build toolchain (`@cloudflare/vite-plugin` → `vinext build`/`pnpm build`) requires Node
  **>= 22.15** (`node:module`'s `registerHooks`). The VM's default `/exec-daemon/node` is 22.14 and
  fails `pnpm build`/`pnpm dev` with
  `SyntaxError: ... does not provide an export named 'registerHooks'`.
- Node 24 is the nvm default (`nvm alias default 24`) and `~/.bashrc` prepends it ahead of
  `/exec-daemon`, so new shells should already run Node 24 with `pnpm` available. If a shell
  resolves the wrong Node: `nvm use 24` or re-source `~/.bashrc`.

## Running the app locally

- By default `pnpm dev` (`vinext dev`) and `pnpm preview` (without `--local`) open a Cloudflare
  **remote proxy session**, because the `EMAIL` `send_email` binding is `remote: true` in
  `wrangler.jsonc`; without Cloudflare auth this hangs and fails with
  `Timed out waiting for authorization code`.
- Fully offline dev (no remote bindings, no login): `CLOUDFLARE_VITE_FORCE_LOCAL=true pnpm dev` —
  serves `http://localhost:3000/` with all bindings local (D1/KV/R2 via Miniflare). The dev server
  binds IPv6 `localhost` (`::1`), so use `http://localhost:3000`, not `http://127.0.0.1:3000`. The
  first request is slow (on-demand Vite compilation); warm requests are fast.
- Or run the built Worker offline: `pnpm build`, then
  `pnpm exec wrangler dev --local --port 3000 --var APP_TEST_MODE:true` (how the E2E harness in
  `tests/e2e/e2e-environment.mjs` runs the app).
- For real remote bindings with `pnpm dev`, authenticate first: `pnpx wrangler login`, or set
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
- Turnstile captcha auto-disables when `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` are
  empty (see `src/flags.ts`), so email/password sign-in works locally without `APP_TEST_MODE`.
  `APP_TEST_MODE:true` also disables it and relaxes rate limiting.
- Local data lives in `.wrangler/state`; seed with `pnpm db:migrate:dev` then `pnpm db:seed` (or
  `pnpm reset`). Sign in with `test@test.com` / `password`.

## Tests

- E2E (`pnpm run test:e2e`) needs the Playwright Chromium browser (kept in `~/.cache/ms-playwright`,
  outside the repo); if missing, run `pnpm exec playwright install chromium`. The E2E runner builds
  the app and starts its own isolated local Wrangler/D1 preview, so no dev server is needed.
