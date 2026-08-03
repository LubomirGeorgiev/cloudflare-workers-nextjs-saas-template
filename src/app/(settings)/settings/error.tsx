"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { PageErrorState } from "@/components/page-error-state";

// Safety net for the whole settings section. Failures a page can explain (a rate limit, a refused
// read) are rendered by that page with the server's own message; production strips the message off
// anything that reaches here, so this deliberately shows generic copy instead of `error.message`.
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Client.Errors");

  useEffect(() => {
    console.error("Settings section error:", error);
  }, [error]);

  return <PageErrorState message={t("unexpected")} onRetry={reset} />;
}
