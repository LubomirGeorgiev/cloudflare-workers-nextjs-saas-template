"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useFormatter, useLocale, useTranslations } from "@/i18n/client";
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
  PAID_PLAN_IDS,
  TEAM_PLANS,
  TEAM_PLAN_IDS,
  YEARLY_DISCOUNT_PERCENT,
  getPlanAmount,
  type BillingInterval,
  type TeamPlanId,
} from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy, mustPayOrCancel } from "@/constants/subscription-lifecycle";
import { formatPrice } from "@/utils/format-price";
import { useIntervalWhen } from "@/hooks/use-interval-when";
import { useRefreshActionToasts } from "@/hooks/use-refresh-action-toasts";
import {
  createSubscriptionAction,
  startTrialSetupAction,
  completeTrialAction,
  changePlanAction,
  cancelSubscriptionAction,
  resumePaymentAction,
  resumeSubscriptionAction,
  getTeamSubscriptionAction,
} from "../billing.actions";
import {
  classifyTrialCompletionFailure,
  type PaymentReturnAction,
  type PaymentReturnOutcome,
  type TrialReturn,
} from "@/lib/billing/payment-return";
import { selectPlanCardAction, type PlanCardAction } from "@/lib/billing/plan-card-action";
import { usePaymentReturn } from "./use-payment-return";
import dynamic from "next/dynamic";

// Stripe Elements only mounts inside the checkout dialog. A static import would put it on the
// client-reference preload path vinext walks on every cold isolate.
const StripePaymentForm = dynamic(
  async () => (await import("./stripe-payment-form")).StripePaymentForm,
  { ssr: false },
);

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 10;
// The element id that the add-on cards link to when the team has no paid plan.
export const PLAN_CARDS_ANCHOR = "plans";
// The price note names the currency only when every paid plan uses the same one.
const PAID_PLAN_CURRENCIES = new Set(PAID_PLAN_IDS.map((planId) => TEAM_PLANS[planId].currency.toUpperCase()));

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
  // Add-ons are items of the same Stripe subscription, so a cancel stops them too.
  hasActiveAddons: boolean;
}

interface PaymentDialogState {
  clientSecret: string;
  currency: string;
  planName: string;
  priceLabel: string;
  trialDays?: number;
  titleKey: "paymentDialogTitle" | "completePaymentDialogTitle";
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
  hasActiveAddons,
}: PlanCardsProps) {
  const t = useTranslations("Client.Dashboard.Billing");
  const tErrors = useTranslations("Client.Errors");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogState | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(currentInterval ?? "month");
  const [isActivating, setIsActivating] = useState(false);
  const activationPollAttemptRef = useRef(0);
  const isActivationPollPendingRef = useRef(false);

  const hasActiveSubscription = currentPlanId !== "free" && hasPaidAccess(status);
  const periodEndDate = planExpiresAt
    ? format.dateTime(planExpiresAt, { year: "numeric", month: "short", day: "numeric" })
    : null;
  const currentPlanPeriodLabel = periodEndDate && hasPaidAccess(status)
    ? t(
        status === "trialing"
          ? "trialEndsOn"
          : cancelAtPeriodEnd
            ? "endsOn"
            : "renewsOn",
        { date: periodEndDate },
      )
    : null;
  const addons = hasActiveAddons ? "active" : "none";
  const cancelDescription = periodEndDate
    ? t("confirmCancelDescriptionWithDate", { date: periodEndDate, addons })
    : t("confirmCancelDescription", { addons });

  const { execute: executeChange, isExecuting: isChanging } = useAction(changePlanAction, {
    onSuccess: ({ data }) => {
      toast.success(data
        ? t("planChanged", { plan: TEAM_PLANS[data.planId].name, interval: data.interval })
        : t("subscriptionActive"));
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorPaymentProvider")),
  });

  const { execute: executeCancel, isExecuting: isCanceling } = useAction(cancelSubscriptionAction, {
    onSuccess: ({ data }) => {
      toast.success(t(data?.canceledNow ? "subscriptionCanceled" : "cancelScheduled"));
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorPaymentProvider")),
  });

  const resumeToasts = useRefreshActionToasts({
    successMessage: t("subscriptionResumed"),
    errorMessage: t("errorPaymentProvider"),
  });
  const { execute: executeResumeSubscription, isExecuting: isResumingSubscription } = useAction(
    resumeSubscriptionAction,
    resumeToasts,
  );

  const { executeAsync: subscribeAsync, isExecuting: isSubscribing } = useAction(createSubscriptionAction);
  const { executeAsync: startTrialSetupAsync, isExecuting: isStartingTrial } = useAction(startTrialSetupAction);
  const { executeAsync: completeTrialAsync, isExecuting: isCompletingTrial } = useAction(completeTrialAction);
  const { executeAsync: resumeAsync, isExecuting: isResuming } = useAction(resumePaymentAction);
  const { executeAsync: getSubscriptionAsync } = useAction(getTeamSubscriptionAction);

  const clearPaymentReturn = usePaymentReturn({ onReturn: handlePaymentReturn });

  const busy = isChanging || isCanceling || isResumingSubscription || isSubscribing || isStartingTrial || isCompletingTrial || isResuming || isActivating;

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
      if (hasPaidAccess(result?.data?.status)) {
        finishActivationPolling(true);
        return;
      }

      if (activationPollAttemptRef.current >= POLL_MAX_ATTEMPTS) {
        // A late webhook must not ask for a payment that is already made: resumePaymentAction
        // reconciles the team row from Stripe first. A failed sync still stops the poll.
        const synced = await resumeAsync({ teamId })
          .then(() => getSubscriptionAsync({ teamId }))
          .catch(() => undefined);
        finishActivationPolling(hasPaidAccess(synced?.data?.status));
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
    options?: Partial<Pick<PaymentDialogState, "trialDays" | "titleKey">>
  ) {
    if (result?.serverError) {
      toast.error(result.serverError.message ?? t("errorPaymentProvider"));
      // A refusal can save a newer status from Stripe; show it.
      router.refresh();
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
      currency: plan.currency,
      planName: plan.name,
      priceLabel: `${formatPrice({ amount, currency: plan.currency, locale })}${t(interval === "year" ? "perYear" : "perMonth")}`,
      titleKey: "paymentDialogTitle",
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
      { trialDays: TEAM_PLANS[planId].trialDays }
    );
  }

  async function handleCompletePayment() {
    openPaymentDialogFromResult(
      currentPlanId,
      currentInterval ?? "month",
      await resumeAsync({ teamId }),
      { titleKey: "completePaymentDialogTitle" }
    );
  }

  // Shared by the inline confirm and the return from a redirect-based payment method.
  // The outcome tells a return whether a reload may run it again.
  async function finishCheckout({ trial }: { trial: TrialReturn | null }): Promise<PaymentReturnOutcome> {
    // Trials only start once the server verifies the confirmed SetupIntent and creates
    // the subscription; a verified card is a hard requirement for trial access.
    if (trial) {
      const result = await completeTrialAsync({ teamId, setupIntentId: trial.setupIntentId }).catch(() => undefined);
      if (!result?.data?.success) {
        const failure = classifyTrialCompletionFailure({
          code: result?.serverError?.code,
          reason: result?.serverError?.reason,
        });
        if (failure === "pending") {
          toast.info(t("trialSetupPending"));
          return "retry";
        }
        toast.error(result?.serverError?.message ?? tErrors("unexpected"));
        return failure;
      }
    }
    setPaymentDialog(null);
    activationPollAttemptRef.current = 0;
    setIsActivating(true);
    return "final";
  }

  // Only a trial dialog confirms a SetupIntent, so a confirmed one always completes a trial.
  async function handlePaymentSuccess(confirmedSetup: TrialReturn | null) {
    const outcome = await finishCheckout({ trial: confirmedSetup });
    // This checkout replaces any return still in the query; a reload must not retry the old one.
    if (outcome === "final") {
      clearPaymentReturn();
    }
  }

  async function handlePaymentReturn(action: PaymentReturnAction): Promise<PaymentReturnOutcome> {
    if (action.kind === "failed") {
      toast.error(t("paymentFailed"));
      return "final";
    }
    if (action.kind === "trialPending" || action.kind === "completeTrial") {
      return finishCheckout({ trial: { setupIntentId: action.setupIntentId } });
    }
    if (action.kind === "poll") {
      return finishCheckout({ trial: null });
    }
    return "final";
  }

  return (
    <div id={PLAN_CARDS_ANCHOR} className="scroll-mt-20 space-y-6">
      {needsPaymentAction && canManage && (
        <CompletePaymentCard
          status={status}
          disabled={busy}
          onCompletePayment={handleCompletePayment}
          onCancelNow={() => executeCancel({ teamId, atPeriodEnd: false })}
        />
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

                <PlanCardActionButton
                  action={selectPlanCardAction({
                    canManage,
                    isFree,
                    isCurrent,
                    status,
                    hasActiveSubscription,
                    cancelAtPeriodEnd,
                    matchesCurrentInterval,
                    offersTrial,
                  })}
                  planName={plan.name}
                  priceLabel={priceLabel}
                  changesInterval={!matchesCurrentInterval}
                  cancelDescription={cancelDescription}
                  trialDays={plan.trialDays ?? 0}
                  billingInterval={billingInterval}
                  disabled={busy}
                  onChangePlan={() => executeChange({ teamId, planId, interval: billingInterval })}
                  onCancel={() => executeCancel({ teamId, atPeriodEnd: true })}
                  onResume={() => executeResumeSubscription({ teamId })}
                  onSubscribe={() => handleSubscribe(planId)}
                  onStartTrial={() => handleStartTrial(planId)}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {PAID_PLAN_CURRENCIES.size === 1 && (
        <p className="text-center text-xs text-muted-foreground">
          {t("pricesCurrencyNote", { currency: [...PAID_PLAN_CURRENCIES].join("") })}
        </p>
      )}

      <Dialog open={paymentDialog !== null} onOpenChange={(open) => !open && setPaymentDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {paymentDialog ? t(paymentDialog.titleKey, { plan: paymentDialog.planName }) : ""}
            </DialogTitle>
          </DialogHeader>
          {paymentDialog && (
            <StripePaymentForm
              clientSecret={paymentDialog.clientSecret}
              currency={paymentDialog.currency}
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

function CompletePaymentCard({
  status,
  disabled,
  onCompletePayment,
  onCancelNow,
}: {
  status: string | null;
  disabled: boolean;
  onCompletePayment: () => void;
  onCancelNow: () => void;
}) {
  const t = useTranslations("Client.Dashboard.Billing");

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{t("completePaymentTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t(mustPayOrCancel(status) ? "pastDuePaymentDescription" : "completePaymentDescription")}
        </p>
        <div className="grid shrink-0 gap-2 sm:grid-flow-col">
          <Button onClick={onCompletePayment} disabled={disabled}>
            {t("completePayment")}
          </Button>
          {mustPayOrCancel(status) && (
            <CancelSubscriptionButton
              disabled={disabled}
              description={t("confirmCancelNowDescription")}
              onConfirm={onCancelNow}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanCardActionButton({
  action,
  planName,
  priceLabel,
  changesInterval,
  cancelDescription,
  trialDays,
  billingInterval,
  disabled,
  onChangePlan,
  onCancel,
  onResume,
  onSubscribe,
  onStartTrial,
}: {
  action: PlanCardAction;
  planName: string;
  priceLabel: string;
  changesInterval: boolean;
  cancelDescription: string;
  trialDays: number;
  billingInterval: BillingInterval;
  disabled: boolean;
  onChangePlan: () => void;
  onCancel: () => void;
  onResume: () => void;
  onSubscribe: () => void;
  onStartTrial: () => void;
}) {
  const t = useTranslations("Client.Dashboard.Billing");

  if (action === "none") {
    return null;
  }
  if (action === "cancelScheduled") {
    return (
      <div className="space-y-2 pt-2">
        <p className="text-xs text-muted-foreground">{t("cancelScheduled")}</p>
        <Button variant="outline" className="w-full" disabled={disabled} onClick={onResume}>
          {t("resumeSubscription")}
        </Button>
      </div>
    );
  }
  if (action === "cancelAtPeriodEnd") {
    return (
      <div className="pt-2">
        <CancelSubscriptionButton
          disabled={disabled}
          description={cancelDescription}
          onConfirm={onCancel}
        />
      </div>
    );
  }

  if (action === "switchInterval" || action === "changePlan") {
    return (
      <PlanChangeButton
        action={action}
        planName={planName}
        priceLabel={priceLabel}
        billingInterval={billingInterval}
        changesInterval={changesInterval}
        disabled={disabled}
        onConfirm={onChangePlan}
      />
    );
  }

  const buttons = {
    startTrial: { label: t("startFreeTrial", { days: trialDays }), variant: "default", onClick: onStartTrial },
    subscribe: { label: t("subscribe"), variant: "default", onClick: onSubscribe },
  } as const;
  const button = buttons[action];

  return (
    <div className="pt-2">
      <Button variant={button.variant} className="w-full" disabled={disabled} onClick={button.onClick}>
        {button.label}
      </Button>
    </div>
  );
}

function PlanChangeButton({
  action,
  planName,
  priceLabel,
  billingInterval,
  changesInterval,
  disabled,
  onConfirm,
}: {
  action: "switchInterval" | "changePlan";
  planName: string;
  priceLabel: string;
  billingInterval: BillingInterval;
  changesInterval: boolean;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations("Client.Dashboard.Billing");
  const isYearly = billingInterval === "year";
  const label = action === "changePlan"
    ? t("changeToPlan", { plan: planName })
    : t(isYearly ? "switchToYearly" : "switchToMonthly");
  const price = `${priceLabel}${t(isYearly ? "perYear" : "perMonth")}`;

  return (
    <div className="pt-2">
      <ConfirmButton
        label={label}
        title={t("confirmPlanChangeTitle", { label })}
        // Stripe starts a new period and invoices at once on an interval change. Without one,
        // changePlanAction prorates onto the next invoice.
        description={t(changesInterval ? "confirmNewPeriodDescription" : "confirmProrationDescription", { price })}
        keepLabel={t("keepCurrentPlan")}
        disabled={disabled}
        onConfirm={onConfirm}
      />
    </div>
  );
}

function CancelSubscriptionButton({
  disabled,
  description,
  onConfirm,
}: {
  disabled: boolean;
  description: string;
  onConfirm: () => void;
}) {
  const t = useTranslations("Client.Dashboard.Billing");

  return (
    <ConfirmButton
      label={t("cancelSubscription")}
      title={t("confirmCancelTitle")}
      description={description}
      keepLabel={t("keepSubscription")}
      disabled={disabled}
      onConfirm={onConfirm}
    />
  );
}

function ConfirmButton({
  label,
  title,
  description,
  keepLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  keepLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" className="w-full" disabled={disabled} />
        }
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{keepLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function hasPaidAccess(status: string | null | undefined): boolean {
  return Boolean(getStripeSubscriptionTransitionPolicy(status)?.grantsPaidAccess);
}
