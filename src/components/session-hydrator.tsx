"use client"

import type { ReactNode } from "react"
import { useEffect, useRef } from "react"

import type { SessionValidationResult } from "@/types"
import { useSessionStore } from "@/state/session"

interface SessionHydratorProps {
  children: ReactNode;
  session: SessionValidationResult;
}

export function SessionHydrator({
  children,
  session,
}: SessionHydratorProps) {
  const hydratedSessionKey = useRef<string | null>(null)

  useEffect(() => {
    const sessionKey = getSessionHydrationKey(session)

    if (hydratedSessionKey.current === sessionKey) {
      return
    }

    useSessionStore.getState().hydrateSessionFromServer(session)
    hydratedSessionKey.current = sessionKey
  }, [session])

  return children
}

export function getSessionHydrationKey(session: SessionValidationResult) {
  return stableStringify(session)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value))
}

function normalizeForStableStringify(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForStableStringify)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, normalizeForStableStringify(nestedValue)]),
  )
}
