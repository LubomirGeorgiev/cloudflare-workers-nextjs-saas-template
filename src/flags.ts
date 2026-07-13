import "server-only"

import { cache } from "react"
import { isTestMode } from "@/utils/is-test-mode"
import type { PublicConfig } from "@/utils/public-config"

export async function isGoogleSSOEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export async function isTurnstileEnabled() {
  if (isTestMode()) {
    return false
  }

  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

// Team-subscription billing is enabled only when all three Stripe values are configured.
// Env-driven (not a compile-time flag) so downstream templates can toggle it per-deployment.
export function isBillingEnabled() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  )
}

export const getPublicConfig = cache(async (): Promise<PublicConfig> => {
  return {
    isGoogleSSOEnabled: await isGoogleSSOEnabled(),
    isTurnstileEnabled: await isTurnstileEnabled(),
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null,
    isBillingEnabled: isBillingEnabled(),
    stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
  }
})
