import type { Route } from "next";

import { hasTeamPermission } from "@/utils/team-auth";
import { TEAM_PERMISSIONS } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTeamSubscription, isTrialEligible } from "@/utils/team-subscription";
import { requireTeamAccess } from "../team-page-guard";
import { isBillingEnabled } from "@/flags";
import { getTranslations } from "next-intl/server";
import type { TeamPlanId } from "@/constants/plans";
import { PlanCards } from "./_components/plan-cards";
import { AddonCards } from "./_components/addon-cards";
import { CustomerPortalButton } from "./_components/customer-portal-button";

interface BillingPageProps {
  params: Promise<{ teamSlug: string }>;
}

export async function generateMetadata({ params }: BillingPageProps) {
  const { teamSlug } = await params;
  const t = await getTranslations("Client.Dashboard.Billing");

  const { team } = await requireTeamAccess(teamSlug);

  return {
    title: `${team.name} — ${t("title")}`,
  };
}

export default async function TeamBillingPage({ params }: BillingPageProps) {
  const { teamSlug } = await params;
  const t = await getTranslations("Client.Dashboard.Billing");

  const { team, session } = await requireTeamAccess(teamSlug);

  // Three independent reads for the already-authorized team; requireTeamAccess above is the
  // access guard and must stay sequential.
  const [canManage, subscription, trialEligible] = await Promise.all([
    hasTeamPermission(team.id, TEAM_PERMISSIONS.ACCESS_BILLING),
    getTeamSubscription(team.id),
    isTrialEligible({ teamId: team.id, userId: session.user.id }),
  ]);

  const header = (
    <PageHeader
      items={[
        { href: "/dashboard", label: t("breadcrumbDashboard") },
        { href: `/dashboard/teams/${team.slug}` as Route, label: team.name },
        { href: `/dashboard/teams/${team.slug}/billing` as Route, label: t("breadcrumbBilling") },
      ]}
    />
  );

  if (!isBillingEnabled()) {
    return (
      <>
        {header}
        <div className="container mx-auto px-5 py-8">
          <Alert>
            <AlertTitle>{t("title")}</AlertTitle>
            <AlertDescription>{t("billingDisabledNotice")}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="container mx-auto space-y-8 px-5 py-8">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
        </div>

        {!canManage && (
          <Alert>
            <AlertDescription>{t("readOnlyNotice")}</AlertDescription>
          </Alert>
        )}

        <PlanCards
          teamId={team.id}
          currentPlanId={subscription.planId as TeamPlanId}
          currentInterval={subscription.interval}
          status={subscription.status}
          planExpiresAt={subscription.planExpiresAt}
          cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
          needsPaymentAction={subscription.needsPaymentAction}
          canManage={canManage}
          isTrialEligible={trialEligible}
        />

        <AddonCards
          teamId={team.id}
          addons={subscription.addons}
          currentInterval={subscription.interval}
          status={subscription.status}
          cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
          canManage={canManage}
        />

        {canManage && team.stripeCustomerId && (
          <div className="flex flex-col items-start gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t("manageBillingDescription")}</p>
            <CustomerPortalButton teamId={team.id} />
          </div>
        )}
      </div>
    </>
  );
}
