import throttle from "lodash.throttle"

import { useUnmount } from "@/hooks/use-unmount"
import { useMemo } from "react"

interface ThrottleSettings {
  leading?: boolean | undefined
  trailing?: boolean | undefined
}

const defaultOptions: ThrottleSettings = {
  leading: false,
  trailing: true,
}

/**
 * A hook that returns a throttled callback function.
 *
 * @param fn The function to throttle
 * @param wait The time in ms to wait before calling the function
 * @param dependencies The dependencies to watch for changes
 * @param options The throttle options
 */
// oxlint-disable-next-line typescript/no-explicit-any
export function useThrottledCallback<T extends (...args: any[]) => any>(
  fn: T,
  wait = 250,
  dependencies: React.DependencyList = [],
  options: ThrottleSettings = defaultOptions
): {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>
  cancel: () => void
  flush: () => void
} {
  const handler = useMemo(
    () => throttle<T>(fn, wait, options),
    dependencies
  )

  useUnmount(() => {
    handler.cancel()
  })

  return handler
}

export default useThrottledCallback
