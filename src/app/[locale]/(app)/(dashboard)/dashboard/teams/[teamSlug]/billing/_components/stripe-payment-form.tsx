"use client";

import { useState, useMemo } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
  Elements,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe, type StripeElements, type StripeElementsOptions } from "@stripe/stripe-js";
import { useAction } from "next-safe-action/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "@/i18n/client";
import { classifyConfirmedIntentStatus, getMicrodepositVerificationUrl } from "@/lib/billing/confirm-outcome";
import { buildPaymentReturnUrl, type TrialReturn } from "@/lib/billing/payment-return";
import { runCheckoutSubmit } from "@/lib/billing/checkout-submit";
import { EU_WITHDRAWAL_ENABLED } from "@/constants";
import { WITHDRAWAL_PERIOD_DAYS } from "@/constants/eu-withdrawal";
import { recordCheckoutConsentAction } from "../billing.actions";

interface StripePaymentFormProps {
  teamId: string;
  // A new checkout asks for the EU immediate-start consent. Paying an open invoice of a running
  // subscription does not: that contract already has its consent.
  collectsConsent: boolean;
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

function submitLabelKey({ isProcessing, isTrial }: { isProcessing: boolean; isTrial: boolean }) {
  if (isProcessing) {
    return "processing";
  }
  return isTrial ? "startTrialAction" : "payNow";
}

// A client secret is `<intent id>_secret_<token>`.
function setupIntentIdFromSecret(clientSecret: string): string {
  return clientSecret.split("_secret_")[0] ?? clientSecret;
}

function PaymentForm({
  consent,
  clientSecret,
  planName,
  priceLabel,
  trialDays,
  onSuccess,
  onCancel,
}: Omit<StripePaymentFormProps, "currency" | "teamId" | "collectsConsent"> & { consent: CheckoutConsent }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const t = useTranslations("Client.Dashboard.Billing");
  const tCommon = useTranslations("Client.Common");
  const tErrors = useTranslations("Client.Errors");

  const isSetupMode = isSetupIntentSecret(clientSecret);
  const isTrial = isSetupMode && Boolean(trialDays);

  function notifyBankVerification(verificationUrl: string) {
    toast.info(t("bankVerificationPending"), {
      duration: Infinity,
      action: { label: t("verifyBankAccount"), onClick: () => window.open(verificationUrl, "_blank", "noopener") },
    });
    onCancel();
  }

  function failPayment(message: string | undefined) {
    toast.error(message || t("paymentFailed"));
    setIsProcessing(false);
  }

  // Do NOT flip subscription state from the client — the server verifies the
  // SetupIntent (setup mode) or the webhook confirms the payment (payment mode).
  async function confirmSetupMode({ stripe, elements, confirmParams }: ConfirmContext) {
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
  }

  async function confirmPaymentMode({ stripe, elements, confirmParams }: ConfirmContext) {
    const result = await stripe.confirmPayment({ elements, confirmParams, redirect: "if_required" });
    if (result.error) {
      failPayment(result.error.message);
      return;
    }
    // The microdeposits take days and the dialog has nothing more to do: say what comes next.
    const verificationUrl = getMicrodepositVerificationUrl(result.paymentIntent);
    if (verificationUrl) {
      notifyBankVerification(verificationUrl);
      return;
    }
    if (classifyConfirmedIntentStatus(result.paymentIntent.status) === "cancel") {
      setIsProcessing(false);
      return;
    }
    onSuccess(null);
  }

  function confirmIntent(context: ConfirmContext) {
    return isSetupMode ? confirmSetupMode(context) : confirmPaymentMode(context);
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
      const context = { stripe, elements, confirmParams: { return_url: buildPaymentReturnUrl(window.location.href) } };
      await runCheckoutSubmit({
        submitFirst: consent.submitFirst,
        submit: () => elements.submit(),
        recordConsent: consent.record,
        confirm: () => confirmIntent(context),
        onFailure: failPayment,
      });
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
              {isTrial
                ? <p>{t("trialPaymentNote", { days: trialDays ?? 0 })}</p>
                : <p>{t("renewalNote", { price: priceLabel })}</p>}
              <p>{t("securePaymentInfo")}</p>
              <p>{t("paymentDetailsInfo")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <form method="post" onSubmit={handleSubmit} className="space-y-8">
        <ImmediateStartConsent consent={consent} disabled={isProcessing} />
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
            {t(submitLabelKey({ isProcessing, isTrial }))}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ImmediateStartConsent({
  consent,
  disabled,
}: {
  consent: CheckoutConsent;
  disabled: boolean;
}) {
  const t = useTranslations("Client.Dashboard.Billing");
  if (!consent.record) {
    return null;
  }

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="immediate-start-consent"
        checked={consent.immediateStart}
        disabled={disabled}
        onCheckedChange={(value) => consent.setImmediateStart(Boolean(value))}
      />
      <Label htmlFor="immediate-start-consent" className="text-sm font-normal leading-snug">
        {t("immediateStartConsent", { days: WITHDRAWAL_PERIOD_DAYS })}
      </Label>
    </div>
  );
}

// The EU immediate-start consent of one checkout. `record` is null when the form asks for none.
function useCheckoutConsent({
  teamId,
  clientSecret,
  collectsConsent,
}: {
  teamId: string;
  clientSecret: string;
  collectsConsent: boolean;
}) {
  const t = useTranslations("Client.Dashboard.Billing");
  // Unticked by default: the consent must be an express act of the buyer, never a pre-ticked box.
  const [immediateStart, setImmediateStart] = useState(false);
  const { executeAsync } = useAction(recordCheckoutConsentAction);

  async function record() {
    const recorded = await executeAsync({
      teamId,
      immediateStart,
      setupIntentId: isSetupIntentSecret(clientSecret) ? setupIntentIdFromSecret(clientSecret) : undefined,
    });

    return recorded?.data?.success ? null : { message: recorded?.serverError?.message ?? t("errorPaymentProvider") };
  }

  return {
    immediateStart,
    setImmediateStart,
    record: EU_WITHDRAWAL_ENABLED && collectsConsent ? record : null,
    // Deferred-intent Elements must validate and collect wallet data before the confirm. With the
    // EU flow on, every mode submits first, so the consent call comes after the wallet sheet.
    submitFirst: EU_WITHDRAWAL_ENABLED || isSetupIntentSecret(clientSecret),
  };
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

  const { clientSecret, currency, teamId, collectsConsent, ...formProps } = props;
  const consent = useCheckoutConsent({ teamId, clientSecret, collectsConsent });
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
      <PaymentForm clientSecret={clientSecret} consent={consent} {...formProps} />
    </Elements>
  );
}

interface ConfirmContext {
  stripe: Stripe;
  elements: StripeElements;
  confirmParams: { return_url: string };
}

type CheckoutConsent = ReturnType<typeof useCheckoutConsent>;
