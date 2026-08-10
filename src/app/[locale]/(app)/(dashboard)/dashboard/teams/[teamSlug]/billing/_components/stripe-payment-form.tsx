"use client";

import { useState, useMemo } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
  Elements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "next-intl";

interface StripePaymentFormProps {
  clientSecret: string;
  planName: string;
  priceLabel: string;
  // Trial checkouts collect a payment method without charging; the length drives the
  // "you won't be charged today" copy and is 0/undefined for immediate payments.
  trialDays?: number;
  // Called after a successful confirm. For setup mode the confirmed SetupIntent id is
  // passed so the parent can complete the trial server-side; payment mode passes
  // nothing and the parent polls until the webhook flips the team active.
  onSuccess: (confirmedSetupIntentId?: string) => void;
  onCancel: () => void;
}

// Trials have no upfront payment, so their client secret belongs to the subscription's
// pending SetupIntent and must be confirmed with confirmSetup instead of confirmPayment.
function isSetupIntentSecret(clientSecret: string): boolean {
  return clientSecret.startsWith("seti_");
}

function PaymentForm({
  clientSecret,
  planName,
  priceLabel,
  trialDays,
  onSuccess,
  onCancel,
}: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const t = useTranslations("Client.Dashboard.Billing");
  const tCommon = useTranslations("Client.Common");
  const tErrors = useTranslations("Client.Errors");

  const isSetupMode = isSetupIntentSecret(clientSecret);
  const isTrial = isSetupMode && Boolean(trialDays);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const result = isSetupMode
        ? await stripe.confirmSetup({ elements, redirect: "if_required" })
        : await stripe.confirmPayment({ elements, redirect: "if_required" });

      if (result.error) {
        toast.error(result.error.message || t("paymentFailed"));
        setIsProcessing(false);
        return;
      }

      // Do NOT flip subscription state from the client — the server verifies the
      // SetupIntent (setup mode) or the webhook confirms the payment (payment mode).
      onSuccess("setupIntent" in result ? result.setupIntent?.id : undefined);
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : tErrors("unexpected"));
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardContent className="pt-6">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{planName}</div>
              <div className="text-2xl font-bold text-primary">{priceLabel}</div>
            </div>
            <div className="h-px bg-border" />
            <div className="text-xs text-muted-foreground space-y-2">
              {isTrial && <p>{t("trialPaymentNote", { days: trialDays ?? 0 })}</p>}
              <p>{t("securePaymentInfo")}</p>
              <p>{t("paymentDetailsInfo")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-8">
        <PaymentElement />
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isProcessing}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isProcessing || !stripe || !elements}
            className="px-8"
          >
            {isProcessing ? t("processing") : isTrial ? t("startTrialAction") : t("payNow")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function StripePaymentForm(props: StripePaymentFormProps) {
  const { resolvedTheme: theme } = useTheme();
  const stripePromise = useMemo(
    () =>
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
        : null,
    []
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: theme === "dark" ? "night" : "stripe",
        },
      }}
    >
      <PaymentForm {...props} />
    </Elements>
  );
}
