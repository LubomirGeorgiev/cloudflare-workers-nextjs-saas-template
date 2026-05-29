"use client"

import type { ReactNode } from "react"
import { useRef } from "react"

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
  const hasHydrated = useRef(false)

  if (!hasHydrated.current) {
    useSessionStore.getState().hydrateSessionFromServer(session)
    hasHydrated.current = true
  }

  return children
}
