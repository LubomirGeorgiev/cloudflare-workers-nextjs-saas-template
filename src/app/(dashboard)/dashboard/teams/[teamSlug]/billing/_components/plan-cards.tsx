"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IS_YEARLY_BILLING_ENABLED,
  TEAM_PLANS,
  TEAM_PLAN_IDS,
  YEARLY_DISCOUNT_PERCENT,
  getPlanAmount,
  type BillingInterval,
  type TeamPlanId,
} from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";
import { formatPrice } from "@/utils/format-price";
import { useIntervalWhen } from "@/hooks/use-interval-when";
import {
  createSubscriptionAction,
  startTrialSetupAction,
  completeTrialAction,
  changePlanAction,
  cancelSubscriptionAction,
  resumePaymentAction,
  getTeamSubscriptionAction,
} from "../billing.actions";
import { StripePaymentForm } from "./stripe-payment-form";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 10;

interface PlanCardsProps {
  teamId: string;
  currentPlanId: TeamPlanId;
  // Billing interval of the team's current subscription; null when free/unknown.
  currentInterval: BillingInterval | null;
  status: string | null;
  planExpiresAt: Date | null;
  cancelAtPeriodEnd: boolean;
  needsPaymentAction: boolean;
  canManage: boolean;
  isTrialEligible: boolean;
}

interface PaymentDialogState {
  clientSecret: string;
  planId: TeamPlanId;
  // Interval captured when the dialog opened; completing a trial must submit exactly
  // what the SetupIntent was created with, not the live toggle state.
  interval: BillingInterval;
  planName: string;
  priceLabel: string;
  trialDays?: number;
  // True when the dialog confirms a trial's SetupIntent (card-first flow) rather than
  // an invoice payment; success must then complete the trial server-side.
  isTrialSetup?: boolean;
}

export function PlanCards({
  teamId,
  currentPlanId,
  currentInterval,
  status,
  planExpiresAt,
  cancelAtPeriodEnd,
  needsPaymentAction,
  canManage,
  isTrialEligible,
}: PlanCardsProps) {
  const t = useTranslations("Client.Dashboard.Billing");
  const tCommon = useTranslations("Client.Common");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogState | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(currentInterval ?? "month");
  const [isActivating, setIsActivating] = useState(false);
  const activationPollAttemptRef = useRef(0);
  const isActivationPollPendingRef = useRef(false);

  const hasActiveSubscription =
    currentPlanId !== "free"
    && Boolean(getStripeSubscriptionTransitionPolicy(status)?.grantsPaidAccess);
  const currentPlanPeriodLabel = planExpiresAt && (status === "active" || status === "trialing")
    ? t(
        status === "trialing"
          ? "trialEndsOn"
          : cancelAtPeriodEnd
            ? "endsOn"
            : "renewsOn",
        {
          date: format.dateTime(planExpiresAt, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
        },
      )
    : null;

  const { execute: executeChange, isExecuting: isChanging } = useAction(changePlanAction, {
    onSuccess: () => {
      toast.success(t("subscriptionActive"));
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorPaymentProvider")),
  });

  const { execute: executeCancel, isExecuting: isCanceling } = useAction(cancelSubscriptionAction, {
    onSuccess: () => {
      toast.success(t("cancelScheduled"));
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorPaymentProvider")),
  });

  const { executeAsync: subscribeAsync, isExecuting: isSubscribing } = useAction(createSubscriptionAction);
  const { executeAsync: startTrialSetupAsync, isExecuting: isStartingTrial } = useAction(startTrialSetupAction);
  const { executeAsync: completeTrialAsync, isExecuting: isCompletingTrial } = useAction(completeTrialAction);
  const { executeAsync: resumeAsync, isExecuting: isResuming } = useAction(resumePaymentAction);
  const { executeAsync: getSubscriptionAsync } = useAction(getTeamSubscriptionAction);

  const busy = isChanging || isCanceling || isSubscribing || isStartingTrial || isCompletingTrial || isResuming || isActivating;

  const stopActivationPolling = useIntervalWhen(
    () => {
      void checkSubscriptionStatus();
    },
    { ms: POLL_INTERVAL_MS, when: isActivating }
  );

  function finishActivationPolling(isActive: boolean) {
    stopActivationPolling();
    setIsActivating(false);
    if (isActive) {
      toast.success(t("subscriptionActive"));
    }
    router.refresh();
  }

  async function checkSubscriptionStatus() {
    if (isActivationPollPendingRef.current) {
      return;
    }

    isActivationPollPendingRef.current = true;
    activationPollAttemptRef.current += 1;

    try {
      const result = await getSubscriptionAsync({ teamId });
      const currentStatus = result?.data?.status;
      if (currentStatus === "active" || currentStatus === "trialing") {
        finishActivationPolling(true);
        return;
      }

      if (activationPollAttemptRef.current >= POLL_MAX_ATTEMPTS) {
        // Refresh after the timeout so the page still reflects the latest webhook state.
        finishActivationPolling(false);
      }
    } finally {
      isActivationPollPendingRef.current = false;
    }
  }

  // Subscribe, trial setup and "complete payment" all return a client secret and open
  // the same Payment Element dialog; share the result-handling here.
  function openPaymentDialogFromResult(
    planId: TeamPlanId,
    interval: BillingInterval,
    result: { serverError?: { message?: string }; data?: { clientSecret?: string } } | undefined,
    options?: Pick<PaymentDialogState, "trialDays" | "isTrialSetup">
  ) {
    if (result?.serverError) {
      toast.error(result.serverError.message ?? t("errorPaymentProvider"));
      return;
    }
    const clientSecret = result?.data?.clientSecret;
    if (!clientSecret) {
      toast.error(t("errorNoClientSecret"));
      return;
    }
    const plan = TEAM_PLANS[planId];
    const amount = getPlanAmount({ plan, interval });
    setPaymentDialog({
      clientSecret,
      planId,
      interval,
      planName: plan.name,
      priceLabel: `${formatPrice({ amount, currency: plan.currency, locale })}${t(interval === "year" ? "perYear" : "perMonth")}`,
      ...options,
    });
  }

  async function handleSubscribe(planId: TeamPlanId) {
    openPaymentDialogFromResult(
      planId,
      billingInterval,
      await subscribeAsync({ teamId, planId, interval: billingInterval })
    );
  }

  async function handleStartTrial(planId: TeamPlanId) {
    openPaymentDialogFromResult(
      planId,
      billingInterval,
      await startTrialSetupAsync({ teamId, planId, interval: billingInterval }),
      {
        trialDays: TEAM_PLANS[planId].trialDays,
        isTrialSetup: true,
      }
    );
  }

  async function handleCompletePayment() {
    openPaymentDialogFromResult(currentPlanId, currentInterval ?? "month", await resumeAsync({ teamId }));
  }

  async function handlePaymentSuccess(confirmedSetupIntentId?: string) {
    // Trials only start once the server verifies the confirmed SetupIntent and creates
    // the subscription; a verified card is a hard requirement for trial access.
    if (paymentDialog?.isTrialSetup) {
      if (!confirmedSetupIntentId) {
        toast.error(t("errorPaymentProvider"));
        return;
      }
      const result = await completeTrialAsync({
        teamId,
        planId: paymentDialog.planId,
        interval: paymentDialog.interval,
        setupIntentId: confirmedSetupIntentId,
      });
      if (result?.serverError || !result?.data?.success) {
        toast.error(result?.serverError?.message ?? t("errorPaymentProvider"));
        return;
      }
    }
    setPaymentDialog(null);
    activationPollAttemptRef.current = 0;
    setIsActivating(true);
  }

  return (
    <div className="space-y-6">
      {needsPaymentAction && canManage && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t("completePaymentTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t("completePaymentDescription")}</p>
            <Button onClick={handleCompletePayment} disabled={busy}>
              {t("completePayment")}
            </Button>
          </CardContent>
        </Card>
      )}

      {isActivating && (
        <p className="text-sm text-muted-foreground">{t("activating")}</p>
      )}

      {IS_YEARLY_BILLING_ENABLED && (
        <Tabs
          value={billingInterval}
          onValueChange={(value) => setBillingInterval(value as BillingInterval)}
          className="flex justify-center"
        >
          <TabsList>
            <TabsTrigger value="month">{t("billingIntervalMonthly")}</TabsTrigger>
            <TabsTrigger value="year">
              {t("billingIntervalYearly")}
              {(YEARLY_DISCOUNT_PERCENT ?? 0) > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-2 border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                >
                  {t("yearlySaveBadge", { percent: YEARLY_DISCOUNT_PERCENT ?? 0 })}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {TEAM_PLAN_IDS.map((planId) => {
          const plan = TEAM_PLANS[planId];
          const isCurrent = planId === currentPlanId;
          const isFree = plan.amount === 0;
          const amount = getPlanAmount({ plan, interval: billingInterval });
          const priceLabel = isFree ? t("freePrice") : formatPrice({ amount, currency: plan.currency, locale });
          // Whether the toggle matches the interval the team already pays on; legacy rows
          // without a recorded interval are treated as matching so no switch is offered.
          const matchesCurrentInterval = currentInterval === null || billingInterval === currentInterval;
          // Offer the trial only where subscribing would actually start one: an eligible
          // team with no subscription yet (plan changes keep the current billing cycle).
          const offersTrial = Boolean(plan.trialDays) && isTrialEligible && !hasActiveSubscription;
          // Marketing copy is optional per plan: a downstream plan without a planContent
          // catalog entry still renders, just with the limits list alone.
          const description = t.has(`planContent.${planId}.description`)
            ? t(`planContent.${planId}.description`)
            : null;
          const rawFeatures = t.has(`planContent.${planId}.features`)
            ? t.raw(`planContent.${planId}.features`)
            : null;
          const featureBullets: string[] = Array.isArray(rawFeatures) ? rawFeatures : [];

          return (
            <Card key={planId} className={isCurrent ? "border-primary" : undefined}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent
                    ? <Badge variant="secondary">{t("currentPlanBadge")}</Badge>
                    : offersTrial && <Badge variant="outline">{t("trialBadge", { days: plan.trialDays ?? 0 })}</Badge>}
                </div>
                {description && (
                  <p className="text-sm text-muted-foreground">{description}</p>
                )}
                <div className="text-3xl font-bold">
                  {priceLabel}
                  {!isFree && (
                    <span className="text-base font-normal text-muted-foreground">
                      {t(billingInterval === "year" ? "perYear" : "perMonth")}
                    </span>
                  )}
                </div>
                {!isFree && billingInterval === "year" && (
                  <p className="text-xs text-muted-foreground">
                    {t("yearlyEquivalentNote", {
                      price: formatPrice({ amount: Math.round(amount / 12), currency: plan.currency, locale }),
                    })}
                  </p>
                )}
                {isCurrent && currentPlanPeriodLabel && (
                  <p className="text-sm font-medium text-foreground">
                    {currentPlanPeriodLabel}
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {t("seatsFeature", { seats: plan.limits.seats })}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {t("projectsFeature", { projects: plan.limits.projects })}
                  </li>
                  {featureBullets.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" /> {feature}
                    </li>
                  ))}
                </ul>

                {canManage && !isFree && (
                  <div className="pt-2">
                    {isCurrent && hasActiveSubscription ? (
                      cancelAtPeriodEnd ? (
                        <p className="text-xs text-muted-foreground">{t("cancelScheduled")}</p>
                      ) : !matchesCurrentInterval ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={busy}
                          onClick={() => executeChange({ teamId, planId, interval: billingInterval })}
                        >
                          {t(billingInterval === "year" ? "switchToYearly" : "switchToMonthly")}
                        </Button>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button variant="outline" className="w-full" disabled={busy} />
                            }
                          >
                            {t("cancelSubscription")}
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("confirmCancelTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("confirmCancelDescription")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => executeCancel({ teamId, atPeriodEnd: true })}>
                                {t("confirmCancelAction")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )
                    ) : hasActiveSubscription ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        disabled={busy}
                        onClick={() => executeChange({ teamId, planId, interval: billingInterval })}
                      >
                        {t("changeToPlan", { plan: plan.name })}
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={busy}
                        onClick={() => offersTrial ? handleStartTrial(planId) : handleSubscribe(planId)}
                      >
                        {offersTrial ? t("startFreeTrial", { days: plan.trialDays ?? 0 }) : t("subscribe")}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={paymentDialog !== null} onOpenChange={(open) => !open && setPaymentDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {paymentDialog ? t("paymentDialogTitle", { plan: paymentDialog.planName }) : ""}
            </DialogTitle>
          </DialogHeader>
          {paymentDialog && (
            <StripePaymentForm
              clientSecret={paymentDialog.clientSecret}
              planName={paymentDialog.planName}
              priceLabel={paymentDialog.priceLabel}
              trialDays={paymentDialog.trialDays}
              onSuccess={handlePaymentSuccess}
              onCancel={() => setPaymentDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
