"use client"

import { useEffect, useRef, type RefObject } from "react"

import { useFetchSession } from "@/hooks/use-fetch-session"
import { useEventListener, useDebounceCallback } from "usehooks-ts"

export function SessionClientSync() {
  const documentRef = useRef(typeof window === "undefined" ? null : document)
  const windowRef = useRef(typeof window === "undefined" ? null : window)
  const fetchSessionNow = useFetchSession()
  const fetchSession = useDebounceCallback(fetchSessionNow, 30)

  useEffect(() => {
    void fetchSession({ reason: "initial" })
  }, [fetchSession])

  useEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void fetchSession({ reason: "visibility" })
    }
  }, documentRef as RefObject<Document>)

  useEventListener("focus", () => {
    void fetchSession({ reason: "focus" })
    // @ts-expect-error window is not defined in the server
  }, windowRef)

  return null
}
