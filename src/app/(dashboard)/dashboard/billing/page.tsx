import type { Route } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/utils/auth";
import { redirectToSignIn } from "@/utils/auth-redirect";

// Team billing lives at /dashboard/teams/[teamSlug]/billing. This thin redirect points
// the generic nav "Billing" item at the session's selected team so nav stays team-agnostic.
export default async function BillingRedirectPage() {
  const session = await getCurrentSession();

  if (!session) {
    return redirectToSignIn("/dashboard/billing");
  }

  const teams = session.teams ?? [];
  const selectedTeam = teams.find((team) => team.id === session.selectedTeam) ?? teams[0];

  if (!selectedTeam) {
    redirect("/dashboard/teams");
  }

  redirect(`/dashboard/teams/${selectedTeam.slug}/billing` as Route);
}
