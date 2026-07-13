import type { Route } from "next";
import { notFound, redirect } from "next/navigation";

import { getSessionFromCookie } from "@/utils/auth";
import { hasTeamMembership, hasTeamPermission } from "@/utils/team-auth";
import { TEAM_PERMISSIONS } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTeamSubscription, isTrialEligible } from "@/utils/team-subscription";
import { getTeamBySlug } from "@/lib/teams/teams";
import { isBillingEnabled } from "@/flags";
import { getTranslations } from "next-intl/server";
import type { TeamPlanId } from "@/constants/plans";
import { PlanCards } from "./_components/plan-cards";

interface BillingPageProps {
  params: Promise<{ teamSlug: string }>;
}

export async function generateMetadata({ params }: BillingPageProps) {
  const { teamSlug } = await params;
  const team = await getTeamBySlug(teamSlug);
  const t = await getTranslations("Client.Dashboard.Billing");

  return {
    title: team ? `${team.name} — ${t("title")}` : t("title"),
  };
}

export default async function TeamBillingPage({ params }: BillingPageProps) {
  const { teamSlug } = await params;
  const t = await getTranslations("Client.Dashboard.Billing");

  const session = await getSessionFromCookie();
  if (!session) {
    redirect(("/sign-in?redirect=" + encodeURIComponent(`/dashboard/teams/${teamSlug}/billing`)) as Route);
  }

  const team = await getTeamBySlug(teamSlug);
  if (!team) {
    notFound();
  }

  const { hasAccess } = await hasTeamMembership(team.id);
  if (!hasAccess) {
    notFound();
  }

  const canManage = await hasTeamPermission(team.id, TEAM_PERMISSIONS.ACCESS_BILLING);
  const subscription = await getTeamSubscription(team.id);
  const trialEligible = await isTrialEligible({ teamId: team.id, userId: session.user.id });

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
          cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
          needsPaymentAction={subscription.needsPaymentAction}
          canManage={canManage}
          isTrialEligible={trialEligible}
        />
      </div>
    </>
  );
}
