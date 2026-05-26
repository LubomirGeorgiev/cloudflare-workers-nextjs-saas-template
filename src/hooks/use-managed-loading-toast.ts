"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";

import { useUnmount } from "@/hooks/use-unmount";

type ToastId = string | number;

export function useManagedLoadingToast() {
  const loadingToastIdRef = useRef<ToastId | undefined>(undefined);

  const dismissLoadingToast = useCallback(() => {
    if (loadingToastIdRef.current === undefined) {
      return;
    }

    toast.dismiss(loadingToastIdRef.current);
    loadingToastIdRef.current = undefined;
  }, []);

  const showLoadingToast = useCallback(
    (message: string) => {
      dismissLoadingToast();
      loadingToastIdRef.current = toast.loading(message);
    },
    [dismissLoadingToast]
  );

  useUnmount(dismissLoadingToast);

  return {
    dismissLoadingToast,
    showLoadingToast,
  };
}
