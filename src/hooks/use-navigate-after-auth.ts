"use client";

import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { useRouter } from "@/i18n/navigation";

// Every auth success raises a toast and then leaves the page. A `window.location` assignment would
// load a new document, tear down the root layout, and destroy the toast before the user reads it —
// so the hand-off has to be a soft navigation, and `refresh()` is what picks up the new session.
export function useNavigateAfterAuth(): (redirectPath?: string) => void {
  const router = useRouter();

  return (redirectPath?: string) => {
    router.refresh();
    router.push(redirectPath || REDIRECT_AFTER_SIGN_IN);
  };
}
