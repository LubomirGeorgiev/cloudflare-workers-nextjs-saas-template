import { createHash } from "node:crypto";
import {
  clickAppRole,
  expectAppPathname,
  fillAppPlaceholder,
  navigateAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  DEFAULT_MESSAGES,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";
import teamPlanCatalog from "../../src/constants/plans.json";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

export const TEAMS_COPY = DEFAULT_MESSAGES.Client.Dashboard.Teams;

// Derived from the plan catalog so the invite test stays correct if a downstream template
// changes seat limits: pick whichever plan grants the most seats to guarantee headroom.
export const planWithMostSeats = Object.entries(
  teamPlanCatalog.plans as Record<string, { limits: { seats: number } }>
).reduce(
  (best, [id, plan]) => (plan.limits.seats > best.seats ? { id, seats: plan.limits.seats } : best),
  { id: "free", seats: 0 }
);

export function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export async function seedPendingInvitation({
  email,
  invitedBy,
  rawToken,
  teamId,
  expiresInSeconds = SEVEN_DAYS_IN_SECONDS,
}: {
  email: string;
  invitedBy: string;
  rawToken: string;
  teamId: string;
  expiresInSeconds?: number;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await queryLocalD1({
    sql: `
      insert into team_invitation (
        id,
        createdAt,
        updatedAt,
        updateCounter,
        teamId,
        email,
        roleId,
        isSystemRole,
        token,
        invitedBy,
        expiresAt,
        acceptedAt,
        acceptedBy
      )
      values (
        ${sqlStringLiteral(`tinv_e2e_${uniqueSuffix()}`)},
        ${now},
        ${now},
        0,
        ${sqlStringLiteral(teamId)},
        ${sqlStringLiteral(email)},
        'member',
        1,
        ${sqlStringLiteral(tokenHash)},
        ${sqlStringLiteral(invitedBy)},
        ${now + expiresInSeconds},
        null,
        null
      );
    `,
  });
}

interface OwnerAndTeam {
  ownerEmail: string;
  ownerId: string;
  teamId: string;
  teamName: string;
  teamPathname: string;
}

// Creates a verified owner (seeded), signs them in, and creates a fresh team through the real
// UI so each test owns an isolated team fixture without cross-test dependencies.
export async function createOwnerAndTeam({ label }: { label: string }): Promise<OwnerAndTeam> {
  const suffix = uniqueSuffix();
  const ownerEmail = `team-owner-${label}-${suffix}@example.com`;
  const teamName = `E2E ${label} ${suffix}`;
  const teamPathname = `/dashboard/teams/${teamName.toLowerCase().replaceAll(" ", "-")}`;

  await createVerifiedUserInLocalD1({
    email: ownerEmail,
    firstName: "Team",
    lastName: "Owner",
  });

  await signInWithPassword({
    email: ownerEmail,
    password: SEEDED_USER_PASSWORD,
    redirectPath: "/dashboard/teams/create",
  });

  await navigateAppFrame("/dashboard/teams/create", { waitForHydration: true });
  await fillAppPlaceholder(TEAMS_COPY.formNamePlaceholder, teamName);
  await fillAppPlaceholder(TEAMS_COPY.formDescriptionPlaceholder, "E2E team fixture.");
  await clickAppRole("button", TEAMS_COPY.createTeam);
  await expectAppPathname(teamPathname);

  const teamId = await queryLocalD1({
    sql: `select id from team where slug = ${sqlStringLiteral(teamPathname.split("/").at(-1)!)};`,
  });
  const ownerId = await queryLocalD1({
    sql: `select userId from team_membership where teamId = ${sqlStringLiteral(teamId)} and roleId = 'owner';`,
  });

  return { ownerEmail, ownerId, teamId, teamName, teamPathname };
}

// A fresh team is on the Free plan (1 seat, filled by the owner), so inviting anyone is
// correctly seat-capped. Grant an active paid subscription to the highest-seat plan to open
// headroom without touching Stripe. Entitlements are read straight from these team columns.
export async function grantTeamSeatHeadroom({
  teamId,
  planId,
}: {
  teamId: string;
  planId: string;
}): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1_000);
  const farFutureSec = nowSec + 365 * 24 * 60 * 60;

  await queryLocalD1({
    sql: `update team set subscriptionPlanId = ${sqlStringLiteral(planId)}, subscriptionStatus = 'active', planExpiresAt = ${farFutureSec}, updatedAt = ${nowSec} where id = ${sqlStringLiteral(teamId)};`,
  });
}

export async function countTeamMembershipsByEmail({
  teamId,
  email,
}: {
  teamId: string;
  email: string;
}): Promise<number> {
  const output = await queryLocalD1({
    sql: `select count(*) from team_membership tm join user u on u.id = tm.userId where tm.teamId = ${sqlStringLiteral(teamId)} and u.email = ${sqlStringLiteral(email)};`,
  });

  return Number(output);
}
