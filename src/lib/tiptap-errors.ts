import { toast } from "sonner"

const TOAST_ID_PREFIX = "tiptap:"

// The `id` dedupes repeats of the same failure. It is separate from the message
// because the display string changes with the locale and with any copy edit.
export function reportTiptapError({ id, message, error }: {
  id: string
  message: string
  error?: unknown
}): void {
  console.error(message, error)
  toast.error(message, {
    id: `${TOAST_ID_PREFIX}${id}`,
    description: error instanceof Error ? error.message : undefined,
  })
}

export function runTiptapCommand({ id, message, command }: {
  id: string
  message: string
  command: () => boolean
}): boolean {
  try {
    if (command()) {
      return true
    }
  } catch (error) {
    reportTiptapError({ id, message, error })
    return false
  }

  reportTiptapError({ id, message })
  return false
}
