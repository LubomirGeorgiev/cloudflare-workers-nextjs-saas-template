"use client"

import { useCallback, useEffect, useState } from "react"
import { useThrottledCallback } from "@/hooks/use-throttled-callback"

// oxlint-disable-next-line project/no-unused-module-exports -- Hook modules intentionally expose reusable app APIs.
export type RectState = Omit<DOMRect, "toJSON">

// oxlint-disable-next-line project/no-unused-module-exports -- Hook modules intentionally expose reusable app APIs.
export interface ElementRectOptions {
  element?: Element | React.RefObject<Element> | string | null
  enabled?: boolean
  throttleMs?: number
  useResizeObserver?: boolean
}

const initialRect: RectState = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

const isSSR = typeof window === "undefined"
const hasResizeObserver = !isSSR && typeof ResizeObserver !== "undefined"

const isClientSide = (): boolean => !isSSR

// oxlint-disable-next-line project/no-unused-module-exports -- Hook modules intentionally expose reusable app APIs.
export function useElementRect({
  element,
  enabled = true,
  throttleMs = 100,
  useResizeObserver = true,
}: ElementRectOptions = {}): RectState {
  const [rect, setRect] = useState<RectState>(initialRect)

  const getTargetElement = useCallback((): Element | null => {
    if (!enabled || !isClientSide()) {
      return null
    }

    if (!element) {
      return document.body
    }

    if (typeof element === "string") {
      return document.querySelector(element)
    }

    if ("current" in element) {
      return element.current
    }

    return element
  }, [element, enabled])

  const updateRect = useThrottledCallback(
    () => {
      if (!enabled || !isClientSide()) {
        return
      }

      const targetElement = getTargetElement()
      if (!targetElement) {
        setRect(initialRect)
        return
      }

      const newRect = targetElement.getBoundingClientRect()
      setRect({
        x: newRect.x,
        y: newRect.y,
        width: newRect.width,
        height: newRect.height,
        top: newRect.top,
        right: newRect.right,
        bottom: newRect.bottom,
        left: newRect.left,
      })
    },
    throttleMs,
    [enabled, getTargetElement],
    { leading: true, trailing: true }
  )

  useEffect(() => {
    if (!enabled || !isClientSide()) {
      setRect(initialRect)
      return
    }

    const targetElement = getTargetElement()
    if (!targetElement) {
      return
    }

    updateRect()

    const cleanup: (() => void)[] = []

    if (useResizeObserver && hasResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(updateRect)
      })
      resizeObserver.observe(targetElement)
      cleanup.push(() => resizeObserver.disconnect())
    }

    const handleUpdate = () => updateRect()

    window.addEventListener("scroll", handleUpdate, true)
    window.addEventListener("resize", handleUpdate, true)

    cleanup.push(() => {
      window.removeEventListener("scroll", handleUpdate)
      window.removeEventListener("resize", handleUpdate)
    })

    return () => {
      cleanup.forEach((fn) => fn())
      setRect(initialRect)
    }
  }, [enabled, getTargetElement, updateRect, useResizeObserver])

  return rect
}

export function useBodyRect(
  options: Omit<ElementRectOptions, "element"> = {}
): RectState {
  return useElementRect({
    ...options,
    element: isClientSide() ? document.body : null,
  })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Hook modules intentionally expose reusable app APIs.
export function useRefRect<T extends Element>(
  ref: React.RefObject<T>,
  options: Omit<ElementRectOptions, "element"> = {}
): RectState {
  return useElementRect({ ...options, element: ref })
}
