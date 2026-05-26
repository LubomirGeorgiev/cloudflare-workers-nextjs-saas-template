import "server-only"

import { cache } from "react"
import { readRuntimeNodeEnv } from "@/utils/runtime-node-env"

export async function isGoogleSSOEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export async function isTurnstileEnabled() {
  if (readRuntimeNodeEnv() === "test") {
    return false
  }

  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

export const getConfig = cache(async () => {
  return {
    isGoogleSSOEnabled: await isGoogleSSOEnabled(),
    isTurnstileEnabled: await isTurnstileEnabled(),
  }
})
