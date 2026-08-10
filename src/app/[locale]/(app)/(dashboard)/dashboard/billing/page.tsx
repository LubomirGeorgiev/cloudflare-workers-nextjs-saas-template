import { redirectToSelectedTeamPage } from "@/utils/auth-redirect";

// Team billing lives at /dashboard/teams/[teamSlug]/billing. This thin redirect points
// the generic nav "Billing" item at the session's selected team so nav stays team-agnostic.
export default async function BillingRedirectPage() {
  return redirectToSelectedTeamPage("billing");
}
