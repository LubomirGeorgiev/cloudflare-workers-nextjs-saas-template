"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * One clipboard write with its toast pair and its stuck-on-copied flag, so no caller has to
 * re-roll `navigator.clipboard.writeText` and silently drop the confirmation.
 *
 * `successMessage` names what was copied when the generic "Copied" is not enough; pass it already
 * translated, because the caller owns the namespace the noun lives in.
 */
export function useCopyToClipboard() {
  const tCommon = useTranslations("Client.Common");
  const [hasCopied, setHasCopied] = useState(false);

  async function copy(value: string, options?: { successMessage?: string }) {
    try {
      await navigator.clipboard.writeText(value);
      setHasCopied(true);
      toast.success(options?.successMessage ?? tCommon("copied"));
    } catch {
      toast.error(tCommon("copyFailed"));
    }
  }

  return { copy, hasCopied };
}
