"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * One clipboard write with its "Copied" toast and its stuck-on-copied flag, so no caller has to
 * re-roll `navigator.clipboard.writeText` and silently drop the confirmation.
 */
export function useCopyToClipboard() {
  const tCommon = useTranslations("Client.Common");
  const [hasCopied, setHasCopied] = useState(false);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setHasCopied(true);
    toast.success(tCommon("copied"));
  }

  return { copy, hasCopied };
}
