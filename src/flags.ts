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

export const getPublicConfig = cache(async (): Promise<PublicConfig> => {
  return {
    isGoogleSSOEnabled: await isGoogleSSOEnabled(),
    isTurnstileEnabled: await isTurnstileEnabled(),
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null,
  }
})
