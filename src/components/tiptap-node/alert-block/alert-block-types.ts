import type { AlertVariant } from "@/components/ui/alert"

// Re-exported so the editor components keep one import site. The value lives in `@/constants`
// because the server content pipeline matches on it too; see that file for why.
export { ALERT_BLOCK_NODE_NAME } from "@/constants/cms-content-nodes"

export const ALERT_BLOCK_VARIANTS = [
  "default",
  "info",
  "success",
  "warning",
  "destructive",
] as const satisfies readonly AlertVariant[]

export const DEFAULT_ALERT_BLOCK_TITLE = "Docs Note"
export const DEFAULT_ALERT_BLOCK_BODY =
  "Use this block to call out important information directly in the article."
export const DEFAULT_ALERT_BLOCK_VARIANT: AlertVariant = "info"

export interface AlertBlockAttrs {
  title?: string
  body?: string
  variant?: AlertVariant
}
