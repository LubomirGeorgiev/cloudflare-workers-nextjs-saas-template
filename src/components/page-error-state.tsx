"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The "this section could not load" card. `message` is already localized by the server — an action's
 * `serverError.message`, or the boundary's fallback — so this renders it verbatim rather than
 * mapping error codes to copy a second time.
 *
 * Client-side only for the retry affordance: `onRetry` for an error boundary's `reset`, otherwise a
 * router refresh, which is what re-runs a failed server render.
 */
export function PageErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("Client.Errors");
  const router = useRouter();
  const [isRetrying, startRetrying] = useTransition();

  function handleRetry() {
    startRetrying(() => {
      if (onRetry) {
        onRetry();
        return;
      }

      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          {t("pageErrorTitle")}
        </CardTitle>
        <CardDescription className="text-foreground/80">{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={isRetrying}>
          <RotateCw className={`size-3.5 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? t("retrying") : t("retry")}
        </Button>
      </CardContent>
    </Card>
  );
}
