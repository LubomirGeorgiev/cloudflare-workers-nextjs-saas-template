"use client"

import { runTiptapCommand } from "@/lib/tiptap-errors"

import { useCallback, useEffect, useRef } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { domOutputSpecToReactElement } from "@tiptap/static-renderer/pm/react"

import { alertBlockDomSpec } from "@/components/tiptap-node/alert-block/alert-block"
import { normalizeAlertBlockAttrs } from "./alert-block-types"
import { setActiveAlertBlockState } from "@/components/tiptap-node/alert-block/alert-block-toolbar-state"
import { cn } from "@/lib/utils"
import type { AlertVariant } from "@/components/ui/alert"

export function AlertBlockNode({
  node,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const { title, body, variant } = normalizeAlertBlockAttrs(node.attrs)
  const alertRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const draftTitleRef = useRef(title)
  const draftBodyRef = useRef(body)

  const updateAlert = useCallback((attrs: Parameters<typeof updateAttributes>[0]) => {
    return runTiptapCommand({
      id: "alert-block-update",
      message: "Could not update the alert",
      command: () => {
        updateAttributes(attrs)
        return true
      },
    })
  }, [updateAttributes])

  const setFocusedAlertState = useCallback(
    (nextVariant: AlertVariant = variant) => {
      setActiveAlertBlockState({
        variant: nextVariant,
        setVariant: (updatedVariant) => {
          if (!updateAlert({ variant: updatedVariant })) {
            return
          }
          setActiveAlertBlockState({
            variant: updatedVariant,
            setVariant: (newVariant) => {
              updateAlert({ variant: newVariant })
            },
          })
        },
      })
    },
    [updateAlert, variant]
  )

  useEffect(() => {
    draftTitleRef.current = title

    if (
      titleRef.current &&
      document.activeElement !== titleRef.current &&
      titleRef.current.textContent !== title
    ) {
      titleRef.current.textContent = title
    }
  }, [title])

  useEffect(() => {
    draftBodyRef.current = body

    if (
      bodyRef.current &&
      document.activeElement !== bodyRef.current &&
      bodyRef.current.innerText !== body
    ) {
      bodyRef.current.innerText = body
    }
  }, [body])

  useEffect(() => {
    if (alertRef.current?.contains(document.activeElement)) {
      setFocusedAlertState(variant)
    }
  }, [setFocusedAlertState, variant])

  useEffect(() => {
    return () => {
      if (alertRef.current?.contains(document.activeElement)) {
        setActiveAlertBlockState(null)
      }
    }
  }, [])

  const handleTitleInput = useCallback(
    (event: React.FormEvent<HTMLHeadingElement>) => {
      draftTitleRef.current = event.currentTarget.textContent ?? ""
    },
    []
  )

  const handleBodyInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      draftBodyRef.current = event.currentTarget.innerText ?? ""
    },
    []
  )

  const handleTitleBlur = useCallback(() => {
    updateAlert({ title: draftTitleRef.current })
  }, [updateAlert])

  const handleBodyBlur = useCallback(() => {
    updateAlert({ body: draftBodyRef.current })
  }, [updateAlert])

  const handleFocusCapture = useCallback(() => {
    setFocusedAlertState()
  }, [setFocusedAlertState])

  const handleBlurCapture = useCallback(() => {
    requestAnimationFrame(() => {
      if (!alertRef.current?.contains(document.activeElement)) {
        setActiveAlertBlockState(null)
      }
    })
  }, [])

  return (
    <NodeViewWrapper
      as="div"
      className="not-prose my-6"
      contentEditable={false}
    >
      {domOutputSpecToReactElement(alertBlockDomSpec({
        attrs: node.attrs,
        editable: true,
        target: "react",
        HTMLAttributes: {
          ref: alertRef,
          class: cn("my-0 cursor-text", selected && "ring-2 ring-ring ring-offset-2"),
          onFocusCapture: handleFocusCapture,
          onBlurCapture: handleBlurCapture,
        },
        titleAttributes: {
          ref: titleRef,
          role: "textbox",
          "aria-label": "Alert title",
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: true,
          class: "rounded-sm px-0.5 outline-none",
          onInput: handleTitleInput,
          onBlur: handleTitleBlur,
          onKeyDown: (event: React.KeyboardEvent<HTMLHeadingElement>) => {
            if (event.key === "Enter") {
              event.preventDefault()
            }
          },
        },
        bodyAttributes: {
          ref: bodyRef,
          role: "textbox",
          "aria-label": "Alert body",
          "aria-multiline": true,
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: true,
          class: "min-h-6 rounded-sm px-0.5 outline-none",
          onInput: handleBodyInput,
          onBlur: handleBodyBlur,
        },
      }))()}
    </NodeViewWrapper>
  )
}
