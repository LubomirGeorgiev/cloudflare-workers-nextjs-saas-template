"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"

import { AUTH_SESSION_PRESENT_COOKIE_NAME } from "@/constants"
import type { getConfig } from "@/flags"
import { useConfigStore } from "@/state/config"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"
import {
  type FetchSessionOptions,
  getSessionFetchPolicy,
  shouldFetchSession,
} from "@/utils/session-fetch-policy"

function getAuthBoundaryKey(session: SessionValidationResult | null) {
  if (!session) {
    return "anonymous"
  }

  return [
    session.id,
    session.user.id,
    session.user.role,
    session.user.emailVerified ? "verified" : "unverified",
  ].join(":")
}

function hasAuthSessionPresentCookie() {
  if (typeof document === "undefined") {
    return true
  }

  return document.cookie
    .split(";")
    .some((cookie) => cookie.trim().startsWith(`${AUTH_SESSION_PRESENT_COOKIE_NAME}=`))
}

export function useFetchSession() {
  const router = useRouter()
  const setSession = useSessionStore((store) => store.setSession)
  const setConfig = useConfigStore((store) => store.setConfig)
  const refetchSession = useSessionStore((store) => store.refetchSession)
  const clearSession = useSessionStore((store) => store.clearSession)

  return useCallback(async ({
    reason = "manual",
  }: FetchSessionOptions = {}) => {
    const currentState = useSessionStore.getState()
    const policy = getSessionFetchPolicy(reason)
    const hasSessionCookie = hasAuthSessionPresentCookie()

    if (!shouldFetchSession({
      hasHydratedSessionFromServer: currentState.hasHydratedSessionFromServer,
      hasSessionCookie,
      lastFetched: currentState.lastFetched,
      reason,
    })) {
      if (reason === "initial" && !currentState.hasHydratedSessionFromServer && !hasSessionCookie) {
        setSession(null)
      }

      return
    }

    try {
      if (policy.showLoading) {
        refetchSession()
      }

      const response = await fetch("/api/get-session")
      const sessionWithConfig = await response.json() as {
        session: SessionValidationResult | undefined
        config: Awaited<ReturnType<typeof getConfig>>
      }
      const nextSession = sessionWithConfig.session ?? null

      setConfig(sessionWithConfig.config)
      setSession(nextSession)

      if (
        policy.refreshOnBoundaryChange &&
        currentState.hasHydratedSessionFromServer &&
        getAuthBoundaryKey(currentState.session) !== getAuthBoundaryKey(nextSession)
      ) {
        router.refresh()
      }
    } catch (error) {
      console.warn("Failed to fetch session:", error)

      if (!policy.passive) {
        clearSession()
      }
    }
  }, [clearSession, refetchSession, router, setConfig, setSession])
}
