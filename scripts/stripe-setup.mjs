// Idempotent Stripe setup for team-subscription billing.
//
// Reads STRIPE_SECRET_KEY from the environment and provisions the products + recurring
// prices the app expects, driven by the SAME plan catalog the app uses
// (src/constants/plans.json), so Stripe and code never drift. Also provisions the
// customer portal configuration the billing page links to. Safe to re-run.
//
//   pnpm stripe:setup [--live] [--with-webhook <publicUrl>] [--no-write] [--dry-run]
//
// By default it upserts the resolved STRIPE_PRICE_* values into .env (a gitignored local
// file; price IDs aren't secrets). --dry-run previews without touching Stripe or .env;
// --no-write creates the Stripe resources but only prints the values.
//
// Uses only the Stripe SDK + env (no Stripe CLI required).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";

import planCatalog from "../src/constants/plans.json" with { type: "json" };
import addonCatalog from "../src/constants/addons.json" with { type: "json" };

const plans = planCatalog.plans;
const addons = addonCatalog.addons;
// When set (0-99), every monthly paid plan also gets a yearly price at this % off.
const yearlyDiscountPercent = planCatalog.yearlyDiscountPercent ?? null;

const REPO_ROOT = join(import.meta.dirname, "..");

// Upsert `KEY=value` entries into a .env file: replace an existing key's line in place
// (matching optional leading `export ` and surrounding whitespace), append only the ones
// that aren't already present. Never duplicates keys on re-run.
function upsertEnvVars(filePath, entries) {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    // No .env yet — start from empty and create it.
  }

  const lines = content.length ? content.split("\n") : [];
  const updated = [];
  const appended = [];

  for (const [key, value] of entries) {
    const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const index = lines.findIndex((line) => matcher.test(line));

    if (index !== -1) {
      lines[index] = `${key}=${value}`;
      updated.push(key);
    } else {
      appended.push([key, value]);
    }
  }

  if (appended.length) {
    // Separate appended vars from prior content with a blank line if needed.
    if (lines.length && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    for (const [key, value] of appended) {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(filePath, lines.join("\n"));

  return { updated, appended: appended.map(([key]) => key) };
}

// The webhook events the app's handler acts on (kept in sync with §D2 of the plan).
const WEBHOOK_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
];

function parseArgs(argv) {
  // Writing price IDs to .env is the DEFAULT (it's a gitignored local file and price IDs
  // aren't secrets). Use --dry-run to preview without any changes, or --no-write to create
  // the Stripe resources but leave .env untouched (just print the values).
  const args = { live: false, dryRun: false, noWrite: false, webhookUrl: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--live") args.live = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-write" || arg === "--print-only") args.noWrite = true;
    else if (arg === "--with-webhook") args.webhookUrl = argv[++i];
    // --write-env accepted for back-compat: writing is now the default, so it's a no-op.
  }
  return args;
}

function paidPlans() {
  return Object.values(plans).filter((plan) => plan.amount > 0);
}

// Derived yearly amount — keep the formula in sync with getYearlyAmount in
// src/constants/plans.ts (the app derives the displayed yearly price the same way).
function yearlyAmount(plan) {
  return Math.round((plan.amount * 12 * (100 - yearlyDiscountPercent)) / 100);
}

// The recurring prices to provision for a plan: its base interval, plus a derived
// yearly variant when yearly billing is enabled and the plan bills monthly.
function priceVariantsForPlan(plan) {
  const variants = [{ interval: plan.interval, amount: plan.amount }];
  if (yearlyDiscountPercent !== null && plan.interval === "month") {
    variants.push({ interval: "year", amount: yearlyAmount(plan) });
  }
  return variants;
}

function priceLookupKey(plan, variant) {
  return `plan_${plan.id}_${variant.interval}`;
}

// Monthly keeps the historical unsuffixed name; yearly gets an explicit _YEAR suffix.
// Must match PRICE_ENV_BY_PLAN in src/utils/plan-prices.ts.
function envVarForPlan(plan, variant) {
  const base = `STRIPE_PRICE_${plan.id.toUpperCase()}`;
  return variant.interval === plan.interval ? base : `${base}_${variant.interval.toUpperCase()}`;
}

// Add-ons bill monthly at their catalog amount, plus a derived yearly variant when
// yearly billing is enabled (they ride on the subscription, whose items must all share
// one interval — a yearly plan can only carry yearly add-on prices).
function priceVariantsForAddon(addon) {
  const variants = [{ interval: "month", amount: addon.amount }];
  if (yearlyDiscountPercent !== null) {
    variants.push({ interval: "year", amount: yearlyAmount(addon) });
  }
  return variants;
}

function priceLookupKeyForAddon(addon, variant) {
  return `addon_${addon.id}_${variant.interval}`;
}

// Must match addonPriceEnvVar in src/utils/plan-prices.ts.
function envVarForAddon(addon, variant) {
  const base = `STRIPE_PRICE_ADDON_${addon.id.toUpperCase().replaceAll("-", "_")}`;
  return variant.interval === "month" ? base : `${base}_YEAR`;
}

async function findProductByPlanId(stripe, planId) {
  // Products don't support metadata search on all accounts; page through active products.
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.template_plan_id === planId) return product;
  }
  return null;
}

async function findProductByAddonId(stripe, addonId) {
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.template_addon_id === addonId) return product;
  }
  return null;
}

async function ensureAddonProduct(stripe, addon, { dryRun }) {
  const existing = await findProductByAddonId(stripe, addon.id);

  if (existing) {
    if (!dryRun) {
      await stripe.products.update(existing.id, {
        name: addon.name,
        metadata: { template_addon_id: addon.id },
      });
    }
    return existing;
  }

  console.log(`  + create product "${addon.name}"`);
  if (dryRun) return { id: `(dry-run:addon-${addon.id})` };

  return stripe.products.create({
    name: addon.name,
    metadata: { template_addon_id: addon.id },
  });
}

async function ensureProduct(stripe, plan, { dryRun }) {
  const existing = await findProductByPlanId(stripe, plan.id);

  if (existing) {
    if (!dryRun) {
      await stripe.products.update(existing.id, {
        name: plan.name,
        metadata: { template_plan_id: plan.id },
      });
    }
    return existing;
  }

  console.log(`  + create product "${plan.name}"`);
  if (dryRun) return { id: `(dry-run:${plan.id})` };

  return stripe.products.create({
    name: plan.name,
    metadata: { template_plan_id: plan.id },
  });
}

async function ensurePrice(stripe, { lookupKey, amount, currency, interval }, product, { dryRun }) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  const existing = found.data[0];

  const matches =
    existing &&
    existing.unit_amount === amount &&
    existing.currency === currency &&
    existing.recurring?.interval === interval;

  if (matches) {
    return existing;
  }

  console.log(`  + create price ${lookupKey} (${amount} ${currency}/${interval})`);
  if (dryRun) return { id: `(dry-run:${lookupKey})` };

  // Prices are immutable — create a new one and transfer the lookup key off the old one.
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: Boolean(existing),
  });

  if (existing) {
    await stripe.prices.update(existing.id, { active: false });
  }

  return price;
}

// Customer portal feature set: billing details (business name, address, VAT/tax IDs —
// all shown on invoices automatically), payment methods, and invoice history are
// self-service; plan changes and cancellation stay in-app so there is one code path.
const PORTAL_FEATURES = {
  customer_update: {
    enabled: true,
    allowed_updates: ["name", "email", "address", "phone", "tax_id"],
  },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: false },
  subscription_update: { enabled: false },
};

async function ensurePortalConfiguration(stripe, { dryRun }) {
  let existing = null;
  for await (const config of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (config.metadata?.template_managed === "true") {
      existing = config;
      break;
    }
  }

  if (existing) {
    if (!dryRun) {
      // Re-apply features on every run so the config never drifts from this script.
      await stripe.billingPortal.configurations.update(existing.id, {
        features: PORTAL_FEATURES,
      });
    }
    return existing;
  }

  console.log("  + create customer portal configuration");
  if (dryRun) return { id: "(dry-run:portal-config)" };

  return stripe.billingPortal.configurations.create({
    features: PORTAL_FEATURES,
    metadata: { template_managed: "true" },
  });
}

async function ensureWebhook(stripe, url, { dryRun }) {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === url) {
      console.log(`  webhook endpoint already exists: ${endpoint.id}`);
      return endpoint;
    }
  }

  console.log(`  + create webhook endpoint ${url}`);
  if (dryRun) return null;

  return stripe.webhookEndpoints.create({ url, enabled_events: WEBHOOK_EVENTS });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error("Missing STRIPE_SECRET_KEY. Set it in .env or the environment.");
    process.exit(1);
  }

  const isTestKey = secretKey.startsWith("sk_test_");
  if (!isTestKey && !args.live) {
    console.error(
      "Refusing to run against a non-test key. Re-run with --live if you really mean it."
    );
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });

  const account = await stripe.accounts.retrieve();
  console.log(`Target Stripe account: ${account.id}${isTestKey ? " (test mode)" : " (LIVE)"}`);
  if (args.dryRun) console.log("Dry run — no changes will be written.\n");

  const envEntries = [];

  for (const plan of paidPlans()) {
    console.log(`Plan: ${plan.name}`);
    const product = await ensureProduct(stripe, plan, args);
    for (const variant of priceVariantsForPlan(plan)) {
      const price = await ensurePrice(
        stripe,
        { lookupKey: priceLookupKey(plan, variant), amount: variant.amount, currency: plan.currency, interval: variant.interval },
        product,
        args,
      );
      envEntries.push([envVarForPlan(plan, variant), price.id]);
    }
  }

  for (const addon of Object.values(addons)) {
    console.log(`Add-on: ${addon.name}`);
    const product = await ensureAddonProduct(stripe, addon, args);
    for (const variant of priceVariantsForAddon(addon)) {
      const price = await ensurePrice(
        stripe,
        { lookupKey: priceLookupKeyForAddon(addon, variant), amount: variant.amount, currency: addon.currency, interval: variant.interval },
        product,
        args,
      );
      envEntries.push([envVarForAddon(addon, variant), price.id]);
    }
  }

  console.log("Customer portal:");
  const portalConfig = await ensurePortalConfiguration(stripe, args);
  envEntries.push(["STRIPE_PORTAL_CONFIG_ID", portalConfig.id]);

  let webhookSecret = null;
  if (args.webhookUrl) {
    console.log(`Webhook:`);
    const endpoint = await ensureWebhook(stripe, args.webhookUrl, args);
    webhookSecret = endpoint?.secret ?? null;
  }

  console.log("\n--- .env values ---");
  for (const [key, value] of envEntries) console.log(`${key}=${value}`);
  if (webhookSecret) console.log(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`);

  console.log("\n--- production secrets (run these) ---");
  console.log("wrangler secret put STRIPE_SECRET_KEY");
  console.log("wrangler secret put STRIPE_WEBHOOK_SECRET");

  if (args.dryRun) {
    console.log("\nDry run — .env not modified.");
  } else if (args.noWrite) {
    console.log("\n--no-write — printed the values above; .env not modified.");
  } else if (envEntries.length) {
    // Only price/config IDs are written to .env — never the secret key or webhook
    // secret. Upsert so re-runs update existing keys in place instead of appending
    // duplicates.
    const envPath = join(REPO_ROOT, ".env");
    const { updated, appended } = upsertEnvVars(envPath, envEntries);
    console.log(
      `\nWrote ${envEntries.length} value(s) to ${envPath} ` +
        `(${updated.length} replaced, ${appended.length} appended).`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
