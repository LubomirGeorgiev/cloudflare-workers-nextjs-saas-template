"use client"

import { useEffect, useState } from "react"
import { useThrottledCallback } from "@/hooks/use-throttled-callback"

// oxlint-disable-next-line project/no-unused-module-exports -- Hook modules intentionally expose reusable app APIs.
export interface WindowSizeState {
  width: number
  height: number
  offsetTop: number
  offsetLeft: number
  scale: number
}

export function useWindowSize(): WindowSizeState {
  const [windowSize, setWindowSize] = useState<WindowSizeState>({
    width: 0,
    height: 0,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 0,
  })

  const handleViewportChange = useThrottledCallback(() => {
    if (typeof window === "undefined") {
      return
    }

    const vp = window.visualViewport
    if (!vp) {
      return
    }

    const {
      width = 0,
      height = 0,
      offsetTop = 0,
      offsetLeft = 0,
      scale = 0,
    } = vp

    setWindowSize((prevState) => {
      if (
        width === prevState.width &&
        height === prevState.height &&
        offsetTop === prevState.offsetTop &&
        offsetLeft === prevState.offsetLeft &&
        scale === prevState.scale
      ) {
        return prevState
      }

      return { width, height, offsetTop, offsetLeft, scale }
    })
  }, 200)

  useEffect(() => {
    const visualViewport = window.visualViewport
    if (!visualViewport) {
      return
    }

    visualViewport.addEventListener("resize", handleViewportChange)

    handleViewportChange()

    return () => {
      visualViewport.removeEventListener("resize", handleViewportChange)
    }
  }, [handleViewportChange])

  return windowSize
}
