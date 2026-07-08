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
import { confirmPayment } from "@/actions/credits.action";
import { useTheme } from "next-themes";
import { Card, CardContent } from "@/components/ui/card";
import { getCreditPackageIcon } from "./credit-package-icon";
import { CREDITS_EXPIRATION_YEARS } from "@/constants";
import { useTranslations } from "next-intl";

interface StripePaymentFormProps {
  packageId: string;
  clientSecret: string;
  onSuccess: () => void;
  onCancel: () => void;
  credits: number;
  price: number;
}

function PaymentForm({ packageId, clientSecret, onSuccess, onCancel, credits, price }: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const t = useTranslations("Client.Dashboard.Billing");
  const tErrors = useTranslations("Client.Errors");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });

      if (error) {
        toast.error(error.message || t("paymentFailed"));
      } else {
        // The payment was successful
        const paymentIntent = await stripe.retrievePaymentIntent(clientSecret);
        if (paymentIntent.paymentIntent) {
          const { data, serverError } = await confirmPayment({
            packageId,
            paymentIntentId: paymentIntent.paymentIntent.id,
          });

          if (serverError) {
            throw new Error(serverError.message);
          }

          if (data?.success) {
            toast.success(t("paymentSuccessful"));
            onSuccess();
          } else {
            toast.error(t("paymentFailed"));
          }
        } else {
          throw new Error(t("errorNoPaymentIntent"));
        }
      }
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : tErrors("unexpected"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardContent className="pt-6">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {getCreditPackageIcon(packageId)}
                <div>
                  <div className="text-2xl font-bold">
                    {t("creditsCount", { count: credits })}
                  </div>
                </div>
              </div>
              <div className="text-2xl font-bold text-primary">
                ${price}
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                {t("securePaymentInfo")}
              </p>
              <p>
                {t("paymentDetailsInfo")}
              </p>
              <p>
                {t("creditsValidityInfo", { years: CREDITS_EXPIRATION_YEARS })}
              </p>
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
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isProcessing || !stripe || !elements}
            className="px-8"
          >
            {isProcessing ? t("processing") : t("payNow")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function StripePaymentForm(props: StripePaymentFormProps) {
  const { resolvedTheme: theme } = useTheme();
  const stripePromise = useMemo(() => process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) : null, []);

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
