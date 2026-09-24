"use client";

import { useState, useMemo } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
  Elements,
} from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "@/i18n/client";
import { classifyConfirmedIntentStatus } from "@/lib/billing/confirm-outcome";
import { buildPaymentReturnUrl, type TrialReturn } from "@/lib/billing/payment-return";

interface StripePaymentFormProps {
  clientSecret: string;
  // The plan currency. Setup mode passes it to Stripe, which then hides the payment methods
  // that cannot pay the subscription (a SetupIntent itself has no currency).
  currency: string;
  planName: string;
  priceLabel: string;
  // Trial checkouts collect a payment method without charging; the length drives the
  // "you won't be charged today" copy and is 0/undefined for immediate payments.
  trialDays?: number;
  // Called once the intent succeeded or is processing. Setup mode passes the SetupIntent so
  // the parent can complete the trial server-side; payment mode passes null and the parent
  // polls until the webhook flips the team active.
  onSuccess: (confirmedSetup: TrialReturn | null) => void;
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
}: Omit<StripePaymentFormProps, "currency">) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const t = useTranslations("Client.Dashboard.Billing");
  const tCommon = useTranslations("Client.Common");
  const tErrors = useTranslations("Client.Errors");

  const isSetupMode = isSetupIntentSecret(clientSecret);
  const isTrial = isSetupMode && Boolean(trialDays);

  function failPayment(message: string | undefined) {
    toast.error(message || t("paymentFailed"));
    setIsProcessing(false);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      // "if_required" keeps cards inline; only a redirect-based method uses return_url. The
      // browser builds it, so Stripe returns to the host that started the checkout.
      const confirmParams = { return_url: buildPaymentReturnUrl(window.location.href) };

      // Do NOT flip subscription state from the client — the server verifies the
      // SetupIntent (setup mode) or the webhook confirms the payment (payment mode).
      if (isSetupMode) {
        // Deferred-intent Elements must validate and collect wallet data before the confirm.
        const { error: submitError } = await elements.submit();
        if (submitError) {
          failPayment(submitError.message);
          return;
        }
        const result = await stripe.confirmSetup({ elements, clientSecret, confirmParams, redirect: "if_required" });
        if (result.error) {
          failPayment(result.error.message);
          return;
        }
        // A closed modal is not a failure: keep the dialog open so the user can pick another method.
        if (classifyConfirmedIntentStatus(result.setupIntent.status) === "cancel") {
          setIsProcessing(false);
          return;
        }
        onSuccess({ setupIntentId: result.setupIntent.id });
        return;
      }

      const result = await stripe.confirmPayment({ elements, confirmParams, redirect: "if_required" });
      if (result.error) {
        failPayment(result.error.message);
        return;
      }
      if (classifyConfirmedIntentStatus(result.paymentIntent.status) === "cancel") {
        setIsProcessing(false);
        return;
      }
      onSuccess(null);
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

// fallow-ignore-next-line unused-export -- Reached by dynamic import from plan-cards.tsx.
export function StripePaymentForm(props: StripePaymentFormProps) {
  const { resolvedTheme: theme } = useTheme();
  const stripePromise = useMemo(
    () =>
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
        : null,
    []
  );

  const { clientSecret, currency, ...formProps } = props;
  const appearanceTheme = theme === "dark" ? "night" : "stripe";
  const options = useMemo<StripeElementsOptions>(() => {
    const appearance = { theme: appearanceTheme } as const;
    // Setup mode uses deferred-intent Elements so Stripe filters methods by the plan currency;
    // `setupFutureUsage` matches the `usage` of the SetupIntent that startTrialSetupAction creates.
    if (isSetupIntentSecret(clientSecret)) {
      return { mode: "setup", currency: currency.toLowerCase(), setupFutureUsage: "off_session", appearance };
    }
    return { clientSecret, appearance };
  }, [clientSecret, currency, appearanceTheme]);

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm clientSecret={clientSecret} {...formProps} />
    </Elements>
  );
}
