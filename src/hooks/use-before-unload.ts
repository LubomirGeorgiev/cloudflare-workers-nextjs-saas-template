import { useCallback, useEffect } from "react";

export default function useBeforeUnload(
  enabled: boolean | (() => boolean) = true,
  message?: string,
) {
  const handler = useCallback(
    (event: BeforeUnloadEvent) => {
      const finalEnabled = typeof enabled === "function" ? enabled() : enabled;

      if (!finalEnabled) {
        return;
      }

      event.preventDefault();

      if (message) {
        event.returnValue = message;
      }

      return message;
    },
    [enabled, message],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    window.addEventListener("beforeunload", handler);

    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, handler]);
}
