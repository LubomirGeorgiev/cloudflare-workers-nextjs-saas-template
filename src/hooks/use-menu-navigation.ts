"use client"

import type { Editor } from "@tiptap/react"
import { useEffect, useState } from "react"

type Orientation = "horizontal" | "vertical" | "both"

interface MenuNavigationOptions<T> {
  editor?: Editor | null
  containerRef?: React.RefObject<HTMLElement | null>
  query?: string
  items: T[]
  onSelect?: (item: T) => void
  onClose?: () => void
  orientation?: Orientation
  autoSelectFirstItem?: boolean
}

export function useMenuNavigation<T>({
  editor,
  containerRef,
  query,
  items,
  onSelect,
  onClose,
  orientation = "vertical",
  autoSelectFirstItem = true,
}: MenuNavigationOptions<T>) {
  const [selectedIndex, setSelectedIndex] = useState<number>(
    autoSelectFirstItem ? 0 : -1
  )

  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      if (!items.length) {
        return false
      }

      const moveNext = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) {
            return 0
          }
          return (currentIndex + 1) % items.length
        })

      const movePrev = () =>
        setSelectedIndex((currentIndex) => {
          if (currentIndex === -1) {
            return items.length - 1
          }
          return (currentIndex - 1 + items.length) % items.length
        })

      switch (event.key) {
        case "ArrowUp": {
          if (orientation === "horizontal") {
            return false
          }
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowDown": {
          if (orientation === "horizontal") {
            return false
          }
          event.preventDefault()
          moveNext()
          return true
        }

        case "ArrowLeft": {
          if (orientation === "vertical") {
            return false
          }
          event.preventDefault()
          movePrev()
          return true
        }

        case "ArrowRight": {
          if (orientation === "vertical") {
            return false
          }
          event.preventDefault()
          moveNext()
          return true
        }

        case "Tab": {
          event.preventDefault()
          if (event.shiftKey) {
            movePrev()
          } else {
            moveNext()
          }
          return true
        }

        case "Home": {
          event.preventDefault()
          setSelectedIndex(0)
          return true
        }

        case "End": {
          event.preventDefault()
          setSelectedIndex(items.length - 1)
          return true
        }

        case "Enter": {
          if (event.isComposing) {
            return false
          }
          event.preventDefault()
          if (selectedIndex !== -1 && items[selectedIndex]) {
            onSelect?.(items[selectedIndex])
          }
          return true
        }

        case "Escape": {
          event.preventDefault()
          onClose?.()
          return true
        }

        default:
          return false
      }
    }

    let targetElement: HTMLElement | null = null

    if (editor) {
      targetElement = editor.view.dom
    } else if (containerRef?.current) {
      targetElement = containerRef.current
    }

    if (targetElement) {
      targetElement.addEventListener("keydown", handleKeyboardNavigation, true)

      return () => {
        targetElement?.removeEventListener(
          "keydown",
          handleKeyboardNavigation,
          true
        )
      }
    }

    return undefined
  }, [
    editor,
    containerRef,
    items,
    selectedIndex,
    onSelect,
    onClose,
    orientation,
  ])

  useEffect(() => {
    if (query) {
      setSelectedIndex(autoSelectFirstItem ? 0 : -1)
    }
  }, [query, autoSelectFirstItem])

  return {
    selectedIndex: items.length ? selectedIndex : undefined,
    setSelectedIndex,
  }
}
