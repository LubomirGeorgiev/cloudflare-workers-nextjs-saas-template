"use client";

import { useCallback, useEffect, useEffectEvent, useRef } from "react";

interface UseIntervalWhenOptions {
  ms: number;
  when: boolean;
  startImmediately?: boolean;
}

export function useIntervalWhen(
  callback: () => void,
  { ms, when, startImmediately = false }: UseIntervalWhenOptions
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onInterval = useEffectEvent(callback);

  const clear = useCallback(() => {
    if (intervalRef.current === null) {
      return;
    }

    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  useEffect(() => {
    clear();

    if (!when) {
      return;
    }

    intervalRef.current = setInterval(onInterval, ms);

    if (startImmediately) {
      onInterval();
    }

    return clear;
  }, [clear, ms, startImmediately, when]);

  return clear;
}
