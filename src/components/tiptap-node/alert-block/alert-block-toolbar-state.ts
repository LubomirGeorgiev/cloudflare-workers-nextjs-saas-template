import type { AlertVariant } from "@/components/ui/alert"

interface ActiveAlertBlockState {
  setVariant: (variant: AlertVariant) => void
  variant: AlertVariant
}

type Listener = () => void

let activeAlertBlockState: ActiveAlertBlockState | null = null
const listeners = new Set<Listener>()

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

export function getActiveAlertBlockState() {
  return activeAlertBlockState
}

export function setActiveAlertBlockState(state: ActiveAlertBlockState | null) {
  activeAlertBlockState = state
  notifyListeners()
}

export function subscribeToActiveAlertBlock(listener: Listener) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
