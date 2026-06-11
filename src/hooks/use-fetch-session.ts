"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"

import { AUTH_SESSION_PRESENT_COOKIE_NAME } from "@/constants"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"
import {
  type FetchSessionOptions,
  getSessionFetchPolicy,
  shouldFetchSession,
} from "@/utils/session-fetch-policy"

type SessionStateSnapshot = ReturnType<typeof useSessionStore.getState>;
type SessionFetchPolicy = ReturnType<typeof getSessionFetchPolicy>;

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

function shouldClearAnonymousInitialSession({
  currentState,
  hasSessionCookie,
  reason,
}: {
  currentState: SessionStateSnapshot;
  hasSessionCookie: boolean;
  reason: FetchSessionOptions["reason"];
}) {
  return reason === "initial" && !currentState.hasHydratedSessionFromServer && !hasSessionCookie;
}

async function fetchSessionFromApi() {
  const response = await fetch("/api/get-session");
  const sessionResponse = await response.json() as {
    session: SessionValidationResult | undefined;
  };

  return sessionResponse.session ?? null;
}

function shouldRefreshRouteForSessionBoundary({
  currentState,
  nextSession,
  policy,
}: {
  currentState: SessionStateSnapshot;
  nextSession: SessionValidationResult | null;
  policy: SessionFetchPolicy;
}) {
  return (
    policy.refreshOnBoundaryChange &&
    currentState.hasHydratedSessionFromServer &&
    getAuthBoundaryKey(currentState.session) !== getAuthBoundaryKey(nextSession)
  );
}

function handleSessionFetchError({
  clearSession,
  error,
  policy,
}: {
  clearSession: () => void;
  error: unknown;
  policy: SessionFetchPolicy;
}) {
  console.warn("Failed to fetch session:", error);

  if (!policy.passive) {
    clearSession();
  }
}

export function useFetchSession() {
  const router = useRouter()
  const setSession = useSessionStore((store) => store.setSession)
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
      if (shouldClearAnonymousInitialSession({ currentState, hasSessionCookie, reason })) {
        setSession(null)
      }

      return
    }

    try {
      if (policy.showLoading) {
        refetchSession()
      }

      const nextSession = await fetchSessionFromApi()

      setSession(nextSession)

      if (shouldRefreshRouteForSessionBoundary({ currentState, nextSession, policy })) {
        router.refresh()
      }
    } catch (error) {
      handleSessionFetchError({ clearSession, error, policy })
    }
  }, [clearSession, refetchSession, router, setSession])
}
