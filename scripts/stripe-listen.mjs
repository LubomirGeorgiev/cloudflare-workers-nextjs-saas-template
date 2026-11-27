// Forward Stripe test events to the local webhook, with STRIPE_SECRET_KEY from .env (no
// `stripe login`). Before it listens, it writes the CLI's signing secret to .env as
// STRIPE_WEBHOOK_SECRET when the two differ.
//
//   pnpm stripe:listen            (STRIPE_LISTEN_PORT=8787 for `pnpm preview`)

import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

import { upsertEnvVars } from "./utils/env-file.mjs";

const DEFAULT_PORT = "3000";
const WEBHOOK_PATH = "/api/stripe/webhook";
const WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";

const REPO_ROOT = join(import.meta.dirname, "..");

function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error("Missing STRIPE_SECRET_KEY. Set it in .env or the environment.");
    process.exit(1);
  }

  // The CLI reads STRIPE_API_KEY, so the key stays out of the process list.
  const childEnv = { ...process.env, STRIPE_API_KEY: secretKey };

  syncWebhookSecret(childEnv);

  const port = process.env.STRIPE_LISTEN_PORT || DEFAULT_PORT;
  const listen = spawn(
    "stripe",
    ["listen", "--forward-to", `localhost:${port}${WEBHOOK_PATH}`, "--all-snapshot", ...process.argv.slice(2)],
    { env: childEnv, stdio: "inherit" },
  );

  listen.on("error", (error) => {
    console.error(`Could not start the Stripe CLI: ${error.message}`);
    process.exit(1);
  });
  // Without this, a SIGTERM to this process would leave the CLI running. The CLI exits with 1
  // after a stop signal, so a stop is a clean exit.
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopped = true;
      listen.kill(signal);
    });
  }
  listen.on("exit", (code, signal) => {
    process.exit(stopped || signal ? 0 : (code ?? 1));
  });
}

function syncWebhookSecret(childEnv) {
  const secret = execFileSync("stripe", ["listen", "--print-secret"], { env: childEnv, encoding: "utf8" }).trim();
  if (!secret.startsWith("whsec_")) {
    console.error("The Stripe CLI did not print a webhook signing secret.");
    process.exit(1);
  }

  if (secret === process.env[WEBHOOK_SECRET_ENV]) {
    return;
  }

  upsertEnvVars(join(REPO_ROOT, ".env"), [[WEBHOOK_SECRET_ENV, secret]]);
  // The dev server reads .env only when it starts.
  console.log(`Wrote a new ${WEBHOOK_SECRET_ENV} to .env. Restart the dev server to use it.`);
}

main();
