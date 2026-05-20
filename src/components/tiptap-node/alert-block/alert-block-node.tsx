"use client"

import { useCallback, useEffect, useRef } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"

import { alertBlockIconByVariant } from "@/components/tiptap-node/alert-block/alert-block"
import {
  DEFAULT_ALERT_BLOCK_BODY,
  DEFAULT_ALERT_BLOCK_TITLE,
  DEFAULT_ALERT_BLOCK_VARIANT,
  type AlertBlockAttrs,
} from "@/components/tiptap-node/alert-block/alert-block-types"
import { setActiveAlertBlockState } from "@/components/tiptap-node/alert-block/alert-block-toolbar-state"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import type { AlertVariant } from "@/components/ui/alert"

export function AlertBlockNode({
  node,
  selected,
  updateAttributes,
}: NodeViewProps) {
  const attrs = node.attrs as AlertBlockAttrs
  const title = attrs.title ?? DEFAULT_ALERT_BLOCK_TITLE
  const body = attrs.body ?? DEFAULT_ALERT_BLOCK_BODY
  const variant = attrs.variant ?? DEFAULT_ALERT_BLOCK_VARIANT
  const Icon = alertBlockIconByVariant[variant]
  const alertRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const draftTitleRef = useRef(title)
  const draftBodyRef = useRef(body)

  const setFocusedAlertState = useCallback(
    (nextVariant: AlertVariant = variant) => {
      setActiveAlertBlockState({
        variant: nextVariant,
        setVariant: (updatedVariant) => {
          updateAttributes({ variant: updatedVariant })
          setActiveAlertBlockState({
            variant: updatedVariant,
            setVariant: (newVariant) => {
              updateAttributes({ variant: newVariant })
            },
          })
        },
      })
    },
    [updateAttributes, variant]
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
    updateAttributes({ title: draftTitleRef.current })
  }, [updateAttributes])

  const handleBodyBlur = useCallback(() => {
    updateAttributes({ body: draftBodyRef.current })
  }, [updateAttributes])

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
      <Alert
        ref={alertRef}
        variant={variant}
        className={cn(
          "my-0 cursor-text",
          selected && "ring-2 ring-ring ring-offset-2"
        )}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
      >
        <Icon className="size-4" />
        <AlertTitle
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          className="rounded-sm px-0.5 outline-none"
          onInput={handleTitleInput}
          onBlur={handleTitleBlur}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
            }
          }}
        >
          {title}
        </AlertTitle>
        <AlertDescription
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          className="min-h-6 whitespace-pre-wrap rounded-sm px-0.5 outline-none"
          onInput={handleBodyInput}
          onBlur={handleBodyBlur}
        >
          {body}
        </AlertDescription>
      </Alert>
    </NodeViewWrapper>
  )
}
