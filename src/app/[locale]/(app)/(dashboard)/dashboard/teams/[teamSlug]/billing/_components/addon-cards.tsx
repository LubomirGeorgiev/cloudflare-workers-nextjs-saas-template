"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TEAM_ADDONS,
  TEAM_ADDON_IDS,
  getAddonAmount,
  getAddonMaxQuantity,
  type TeamAddonId,
  type TeamAddonQuantities,
} from "@/constants/addons";
import type { BillingInterval } from "@/constants/plans";
import { getStripeSubscriptionTransitionPolicy } from "@/constants/subscription-lifecycle";
import { formatPrice } from "@/utils/format-price";
import { updateAddonQuantityAction } from "../billing.actions";

interface AddonCardsProps {
  teamId: string;
  // Add-on units currently on the subscription (the reconciled team-row snapshot).
  addons: TeamAddonQuantities;
  // Billing interval of the current subscription; add-on prices must match it.
  currentInterval: BillingInterval | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
}

export function AddonCards({
  teamId,
  addons,
  currentInterval,
  status,
  cancelAtPeriodEnd,
  canManage,
}: AddonCardsProps) {
  const t = useTranslations("Client.Dashboard.Billing");
  const router = useRouter();

  const { execute, isExecuting } = useAction(updateAddonQuantityAction, {
    onSuccess: () => {
      toast.success(t("addonUpdated"));
      router.refresh();
    },
    onError: ({ error }) => toast.error(error.serverError?.message ?? t("errorPaymentProvider")),
  });

  if (!TEAM_ADDON_IDS.length) {
    return null;
  }

  const hasPaidAccess = Boolean(getStripeSubscriptionTransitionPolicy(status)?.grantsPaidAccess);
  // A subscription already ending should not take on new recurring items.
  const canEdit = canManage && hasPaidAccess && !cancelAtPeriodEnd;

  return (
    <div>
      <h2 className="text-2xl font-semibold">{t("addonsTitle")}</h2>
      <p className="mt-1 text-muted-foreground">{t("addonsSubtitle")}</p>
      {!hasPaidAccess && (
        <p className="mt-2 text-sm text-muted-foreground">{t("addonsRequirePaidPlan")}</p>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {TEAM_ADDON_IDS.map((addonId) => (
          <AddonCard
            key={addonId}
            addonId={addonId}
            active={addons[addonId] ?? 0}
            interval={currentInterval ?? "month"}
            canEdit={canEdit}
            isExecuting={isExecuting}
            onUpdate={(quantity) => execute({ teamId, addonId, quantity })}
          />
        ))}
      </div>
    </div>
  );
}

interface AddonCardProps {
  addonId: TeamAddonId;
  // Units currently on the subscription.
  active: number;
  interval: BillingInterval;
  canEdit: boolean;
  isExecuting: boolean;
  onUpdate: (quantity: number) => void;
}

function AddonCard({ addonId, active, interval, canEdit, isExecuting, onUpdate }: AddonCardProps) {
  const t = useTranslations("Client.Dashboard.Billing");
  const locale = useLocale();
  const [quantity, setQuantity] = useState(active);

  const addon = TEAM_ADDONS[addonId];
  const maxQuantity = getAddonMaxQuantity(addon);
  const unitAmount = getAddonAmount({ addon, interval });
  const intervalSuffix = t(interval === "year" ? "perYear" : "perMonth");
  const isDirty = quantity !== active;

  // Marketing copy is optional per add-on, mirroring the plans' planContent.
  // TeamAddonId is a plain string (the catalog is downstream-editable data), so the
  // dynamic key needs a cast — t.has() still guards the actual lookup.
  const descriptionKey = `addonContent.${addonId}.description` as Parameters<typeof t>[0];
  const description = t.has(descriptionKey) ? t(descriptionKey) : null;

  // What the SELECTED quantity grants/costs, so the summary previews an edit in place.
  const grantedSeats = (addon.limits?.seats ?? 0) * quantity;
  const grantedProjects = (addon.limits?.projects ?? 0) * quantity;
  const summary = [
    grantedSeats > 0 ? t("addonSeatsGrant", { seats: grantedSeats }) : null,
    grantedProjects > 0 ? t("addonProjectsGrant", { projects: grantedProjects }) : null,
    `${formatPrice({ amount: unitAmount * quantity, currency: addon.currency, locale })}${intervalSuffix}`,
  ].filter(Boolean).join(" · ");

  return (
    <Card className={active > 0 ? "border-primary" : undefined}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle>{addon.name}</CardTitle>
          {active > 0 && (
            <Badge variant="secondary">{t("addonActiveBadge", { quantity: active })}</Badge>
          )}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="text-3xl font-bold">
          {formatPrice({ amount: unitAmount, currency: addon.currency, locale })}
          <span className="text-base font-normal text-muted-foreground">
            {intervalSuffix} {t("addonEach")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("addonDecrease")}
            disabled={!canEdit || isExecuting || quantity <= 0}
            onClick={() => setQuantity(quantity - 1)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="min-w-8 text-center text-lg font-semibold tabular-nums">
            {quantity}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("addonIncrease")}
            disabled={!canEdit || isExecuting || quantity >= maxQuantity}
            onClick={() => setQuantity(quantity + 1)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {quantity > 0 && <p className="text-sm text-muted-foreground">{summary}</p>}

        {canEdit && isDirty && (
          <Button className="w-full" disabled={isExecuting} onClick={() => onUpdate(quantity)}>
            {active === 0
              ? t("addonAdd")
              : quantity === 0
                ? t("addonRemove")
                : t("addonUpdate")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
