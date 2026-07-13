"use client";

import { useAction } from "next-safe-action/hooks";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createBillingPortalSessionAction } from "../billing.actions";

interface CustomerPortalButtonProps {
  teamId: string;
}

export function CustomerPortalButton({ teamId }: CustomerPortalButtonProps) {
  const t = useTranslations("Client.Dashboard.Billing");

  const { execute, isExecuting, hasSucceeded } = useAction(createBillingPortalSessionAction, {
    onSuccess: ({ data }) => {
      if (data?.url) {
        window.location.assign(data.url);
        return;
      }
      toast.error(t("errorBillingPortal"));
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorBillingPortal")),
  });

  return (
    <Button
      variant="outline"
      onClick={() => execute({ teamId })}
      // hasSucceeded keeps the button disabled while the browser navigates to Stripe.
      disabled={isExecuting || hasSucceeded}
    >
      <ExternalLink />
      {t("manageBilling")}
    </Button>
  );
}
