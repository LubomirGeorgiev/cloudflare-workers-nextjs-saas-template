import { useRef, useEffect } from "react"

// oxlint-disable-next-line typescript/no-explicit-any
export const useUnmount = (callback: (...args: Array<any>) => any) => {
  const ref = useRef(callback)
  ref.current = callback

  useEffect(
    () => () => {
      ref.current()
    },
    []
  )
}

export default useUnmount
