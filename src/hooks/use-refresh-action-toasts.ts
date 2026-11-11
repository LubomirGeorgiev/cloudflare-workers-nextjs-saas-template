"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * The `useAction` callbacks of a dashboard action that changes server data: a toast for the
 * result, then a refresh so the server components show the change. Pass the messages translated.
 * An action can save the live state before it refuses, so the error path refreshes too.
 */
export function useRefreshActionToasts({
  successMessage,
  errorMessage,
}: {
  successMessage: string;
  errorMessage: string;
}) {
  const router = useRouter();

  return {
    onError: ({ error }: { error: { serverError?: { message: string } } }) => {
      toast.error(error.serverError?.message ?? errorMessage);
      router.refresh();
    },
    onSuccess: () => {
      toast.success(successMessage);
      router.refresh();
    },
  };
}
