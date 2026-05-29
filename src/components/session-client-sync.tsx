"use client"

import { useCallback, useEffect, useRef, type RefObject } from "react"
import { useRouter } from "next/navigation"

import type { getConfig } from "@/flags"
import { useConfigStore } from "@/state/config"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"
import { useEventListener, useDebounceCallback } from "usehooks-ts"

const SESSION_REVALIDATE_INTERVAL_MS = 60_000

type SessionFetchReason = "initial" | "manual" | "revalidate"

interface FetchSessionOptions {
  reason?: SessionFetchReason
}

function isSessionFresh(lastFetched: Date | null) {
  return Boolean(
    lastFetched &&
      Date.now() - lastFetched.getTime() < SESSION_REVALIDATE_INTERVAL_MS
  )
}

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

export function SessionClientSync() {
  const router = useRouter()
  const setSession = useSessionStore((store) => store.setSession)
  const setConfig = useConfigStore((store) => store.setConfig)
  const refetchSession = useSessionStore((store) => store.refetchSession)
  const clearSession = useSessionStore((store) => store.clearSession)
  const documentRef = useRef(typeof window === "undefined" ? null : document)
  const windowRef = useRef(typeof window === "undefined" ? null : window)

  const doFetchSession = useCallback(async ({
    reason = "manual",
  }: FetchSessionOptions = {}) => {
    const currentState = useSessionStore.getState()

    if (
      reason === "initial" &&
      (currentState.hasHydratedSessionFromServer || currentState.lastFetched)
    ) {
      return
    }

    if (reason === "revalidate" && isSessionFresh(currentState.lastFetched)) {
      return
    }

    try {
      if (reason !== "revalidate") {
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
        reason === "revalidate" &&
        currentState.hasHydratedSessionFromServer &&
        getAuthBoundaryKey(currentState.session) !== getAuthBoundaryKey(nextSession)
      ) {
        router.refresh()
      }
    } catch (error) {
      console.warn("Failed to fetch session:", error)

      if (reason !== "revalidate") {
        clearSession()
      }
    }
  }, [clearSession, refetchSession, router, setConfig, setSession])

  const fetchSession = useDebounceCallback(doFetchSession, 30)

  useEffect(() => {
    fetchSession({ reason: "initial" })
  }, [fetchSession])

  useEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchSession({ reason: "revalidate" })
    }
  }, documentRef as RefObject<Document>)

  useEventListener("focus", () => {
    fetchSession({ reason: "revalidate" })
    // @ts-expect-error window is not defined in the server
  }, windowRef)

  useEffect(() => {
    useSessionStore.setState({ fetchSession: doFetchSession })
  }, [doFetchSession])

  return null
}
