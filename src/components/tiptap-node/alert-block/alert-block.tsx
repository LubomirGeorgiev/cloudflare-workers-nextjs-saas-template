import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  DEFAULT_ALERT_BLOCK_BODY,
  DEFAULT_ALERT_BLOCK_TITLE,
  DEFAULT_ALERT_BLOCK_VARIANT,
  type AlertBlockAttrs,
} from "@/components/tiptap-node/alert-block/alert-block-types"
import type { AlertVariant } from "@/components/ui/alert"

export const alertBlockIconByVariant: Record<AlertVariant, typeof InfoIcon> = {
  default: InfoIcon,
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  destructive: AlertCircleIcon,
} as const

export function AlertBlock({
  title = DEFAULT_ALERT_BLOCK_TITLE,
  body = DEFAULT_ALERT_BLOCK_BODY,
  variant = DEFAULT_ALERT_BLOCK_VARIANT,
}: AlertBlockAttrs) {
  const Icon = alertBlockIconByVariant[variant]

  return (
    <Alert variant={variant} className="my-6">
      <Icon className="size-4" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {body ? <AlertDescription>{body}</AlertDescription> : null}
    </Alert>
  )
}
