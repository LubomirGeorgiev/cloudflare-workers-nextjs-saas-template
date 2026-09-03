/// <reference types="@cloudflare/vitest-plugin/types" />

// A ban is only real where it is checked, so this is where the feature is actually proven: real
// Miniflare D1 and KV, the real revocation order, and the real queue payloads.
//
// Two things are mocked and nothing else. Stripe, because a cancel is a network call and the point
// here is which parameters it receives; and the OAuth grant module, because it reaches the
// provider, which is exercised in its own suite.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { env } from "cloudflare:workers";

const { stripeState, connectedAppsState, sessionState, enqueueRetryMock, queueSendMock } = vi.hoisted(() => ({
  stripeState: {
    cancelCalls: [] as { id: string; params: unknown }[],
    failNext: new Set<string>(),
    // Subscription id -> the team it belongs to, so the fake can return a snapshot
    // `reconcileTeamFromSubscription` can resolve, exactly as Stripe's own would.
    teamBySubscription: new Map<string, string>(),
  },
  connectedAppsState: {
    grants: [] as { grantId: string; clientId: string }[],
    revoked: [] as string[],
  },
  // How many session deletes must reject before the real one runs again, so a test can leave a ban
  // half finished and prove the next ban repairs it.
  sessionState: { failDeletes: 0 },
  enqueueRetryMock: vi.fn(async () => undefined),
  queueSendMock: vi.fn(),
}));

function canceledSubscription(id: string) {
  const teamId = stripeState.teamBySubscription.get(id);

  return {
    id,
    object: "subscription",
    status: "canceled",
    customer: teamId ? `cus_${teamId}` : null,
    metadata: teamId ? { teamId } : {},
    items: { data: [] },
    cancel_at_period_end: false,
  };
}

vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    subscriptions: {
      cancel: async (id: string, params: unknown) => {
        stripeState.cancelCalls.push({ id, params });

        if (stripeState.failNext.has(id)) {
          throw new Error(`Stripe is unreachable for ${id}`);
        }

        return canceledSubscription(id);
      },
      retrieve: async (id: string) => canceledSubscription(id),
    },
    invoices: { list: async () => ({ data: [] }) },
  }),
}));

vi.mock("@/lib/oauth/connected-apps", () => ({
  listConnectedAppsForUser: async () => connectedAppsState.grants,
  revokeConnectedAppForUser: async ({ grantId }: { grantId: string }) => {
    connectedAppsState.revoked.push(grantId);
  },
}));

// `enqueue.ts` reads the queue binding straight off `cloudflare:workers`, so the retry is spied on
// at the helper rather than at the binding.
vi.mock("@/lib/scheduler/enqueue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scheduler/enqueue")>()),
  enqueueBillingCancelSubscription: enqueueRetryMock,
}));

// Only the session delete is wrapped, and only while a test asks for it: everything else in this
// module — including the session probe's own reads — stays the real KV implementation.
vi.mock("@/utils/kv-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/kv-session")>();

  return {
    ...original,
    deleteAllSessionsOfUser: async (userId: string) => {
      if (sessionState.failDeletes > 0) {
        sessionState.failDeletes -= 1;
        throw new Error("KV is unreachable");
      }

      return original.deleteAllSessionsOfUser(userId);
    },
  };
});

// The integration environment is localhost-shaped, where every email is logged instead of queued.
// These tests are about the deployed path, so the switch is mocked off and the queue writes are real.
vi.mock("@/utils/is-local", () => ({ isLocalhost: false }));

// The email path goes through `getCloudflareContext`, so swapping only the queue binding leaves
// D1 and KV real while every queued message is captured.
vi.mock("@/utils/cloudflare-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils/cloudflare-context")>();

  return {
    ...original,
    getCloudflareContext: async () => {
      const context = await original.getCloudflareContext();

      return { ...context, env: { ...context.env, SCHEDULER_QUEUE: { send: queueSendMock } } };
    },
  };
});

import { eq } from "drizzle-orm";

import { ROLES_ENUM } from "@/app/enums";
import { getDB } from "@/db";
import {
  apiKeyTable,
  SYSTEM_ROLES_ENUM,
  teamInvitationTable,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { DEFAULT_PLAN_ID, PAID_PLAN_IDS } from "@/constants/plans";
import { banUser, listUserBanEvents, unbanUser } from "@/lib/admin/user-ban";
import { EMAIL_TEMPLATE_TYPES, SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { getApiKeyPrincipal } from "@/utils/kv-api-key";
import { CURRENT_SESSION_VERSION, type KVSession } from "@/utils/kv-session";
import { generateApiKey } from "@/utils/api-key-format";
import { renderTransactionalEmail } from "@/utils/email";

const db = getDB();
const PAID_PLAN_ID = PAID_PLAN_IDS[0];

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM user_ban_event"),
    env.D1_DB.prepare("DELETE FROM api_key"),
    env.D1_DB.prepare("DELETE FROM team_invitation"),
    env.D1_DB.prepare("DELETE FROM team_membership"),
    env.D1_DB.prepare("DELETE FROM team"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);

  const keys = await env.KV_STORE.list();
  await Promise.all(keys.keys.map((key) => env.KV_STORE.delete(key.name)));
}

async function seedUser({
  role = ROLES_ENUM.USER,
  email,
}: { role?: string; email?: string | null } = {}): Promise<string> {
  const userId = uid("usr");

  await db.insert(userTable).values({
    id: userId,
    email: email === null ? null : email ?? `${userId}@example.com`,
    emailVerified: new Date(),
    firstName: "Test",
    role: role as typeof ROLES_ENUM.USER,
  });

  return userId;
}

async function seedTeam({
  ownerId,
  subscriptionId,
}: {
  ownerId?: string;
  subscriptionId?: string | null;
} = {}): Promise<string> {
  const teamId = uid("team");

  await db.insert(teamTable).values({
    id: teamId,
    name: "Acme",
    slug: teamId,
    subscriptionPlanId: subscriptionId ? PAID_PLAN_ID : DEFAULT_PLAN_ID,
    subscriptionStatus: subscriptionId ? "active" : null,
    stripeCustomerId: subscriptionId ? `cus_${teamId}` : null,
    stripeSubscriptionId: subscriptionId ?? null,
  });

  if (subscriptionId) {
    stripeState.teamBySubscription.set(subscriptionId, teamId);
  }

  if (ownerId) {
    await addMember({ teamId, userId: ownerId, roleId: SYSTEM_ROLES_ENUM.OWNER });
  }

  return teamId;
}

async function addMember({
  teamId,
  userId,
  roleId,
}: {
  teamId: string;
  userId: string;
  roleId: string;
}): Promise<void> {
  await db.insert(teamMembershipTable).values({
    id: uid("tmem"),
    teamId,
    userId,
    roleId,
    isSystemRole: 1,
    isActive: 1,
  });
}

// Generated rather than hand-built: `looksLikeApiKey` checks the wire format's checksum offline,
// so a made-up string is refused before any lookup and would make the "before" assertion vacuous.
async function seedApiKey(userId: string): Promise<{ secret: string; keyHash: string }> {
  const { secret, hash, prefix, last4 } = await generateApiKey();

  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    name: "Integration key",
    keyHash: hash,
    keyPrefix: prefix,
    last4,
    scopes: ["teams:read"],
  });

  return { secret, keyHash: hash };
}

async function seedSession(userId: string): Promise<string> {
  const user = await db.query.userTable.findFirst({ where: { id: userId } });
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionId = uid("sess");

  const session: KVSession = {
    id: sessionId,
    userId,
    expiresAt: expiresAt.getTime(),
    createdAt: Date.now(),
    user: user as KVSession["user"],
    teams: [],
    version: CURRENT_SESSION_VERSION,
  };
  const key = `session:${userId}:${sessionId}`;

  await env.KV_STORE.put(key, JSON.stringify(session), {
    expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });

  return key;
}

/** Every EMAIL_SEND message the ban or unban queued, in order. */
function queuedEmails() {
  return queueSendMock.mock.calls
    .map(([message]) => message as { type: string; payload: Record<string, unknown> })
    .filter((message) => message.type === SCHEDULED_JOB_TYPES.EMAIL_SEND);
}

const BAN_INPUT = { internalReason: "Card testing", sendEmail: false, externalReason: undefined };

beforeEach(async () => {
  await clearRows();
  stripeState.cancelCalls = [];
  stripeState.failNext = new Set();
  stripeState.teamBySubscription = new Map();
  connectedAppsState.grants = [];
  connectedAppsState.revoked = [];
  sessionState.failDeletes = 0;
  vi.clearAllMocks();
});

describe("banning an account", () => {
  test("revokes every API key, deletes every session, and refuses the key afterwards", async () => {
    const userId = await seedUser();
    const { secret } = await seedApiKey(userId);
    const sessionKey = await seedSession(userId);

    // The key resolves before the ban, which is what makes the "after" assertion mean something.
    expect(await getApiKeyPrincipal(secret)).not.toBeNull();

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.revokedApiKeyCount).toBe(1);
    expect(await getApiKeyPrincipal(secret)).toBeNull();
    expect(await env.KV_STORE.get(sessionKey)).toBeNull();

    const keys = await db.query.apiKeyTable.findMany({ where: { userId } });
    expect(keys.every((key) => key.revokedAt !== null)).toBe(true);
  });

  test("revokes every OAuth grant", async () => {
    const userId = await seedUser();
    connectedAppsState.grants = [
      { grantId: "grant-1", clientId: "client-1" },
      { grantId: "grant-2", clientId: "client-2" },
    ];

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.revokedGrantCount).toBe(2);
    expect(connectedAppsState.revoked.sort()).toEqual(["grant-1", "grant-2"]);
  });

  test("revokes the pending invitations the banned user sent, and nobody else's", async () => {
    const userId = await seedUser();
    const otherId = await seedUser();
    const teamId = await seedTeam({ ownerId: userId });

    await db.insert(teamInvitationTable).values([
      {
        id: uid("tinv"),
        teamId,
        email: "invitee@example.com",
        roleId: SYSTEM_ROLES_ENUM.MEMBER,
        token: uid("tok"),
        invitedBy: userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        id: uid("tinv"),
        teamId,
        email: "other@example.com",
        roleId: SYSTEM_ROLES_ENUM.MEMBER,
        token: uid("tok"),
        invitedBy: otherId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    ]);

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.revokedInvitationCount).toBe(1);
    const remaining = await db.query.teamInvitationTable.findMany({});
    expect(remaining.map((row) => row.invitedBy)).toEqual([otherId]);
  });

  test("rejects and deletes a session snapshot that carries the ban, even one written directly", async () => {
    const userId = await seedUser();
    await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    // Written after the ban deleted the real ones, standing in for a sign-in that raced it.
    const sessionKey = await seedSession(userId);
    expect(await env.KV_STORE.get(sessionKey)).not.toBeNull();

    const { getCurrentSessionForKey } = await import("./helpers/session-probe");
    expect(await getCurrentSessionForKey(sessionKey)).toBeNull();
    expect(await env.KV_STORE.get(sessionKey)).toBeNull();
  });
});

describe("banning an account that owns teams", () => {
  test("cancels an owned team's subscription with the revenue-preserving parameters", async () => {
    const userId = await seedUser();
    const teamId = await seedTeam({ ownerId: userId, subscriptionId: "sub_owned" });

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.cancelledSubscriptionCount).toBe(1);
    expect(stripeState.cancelCalls).toHaveLength(1);
    expect(stripeState.cancelCalls[0]?.params).toMatchObject({
      invoice_now: true,
      prorate: false,
    });

    const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
    expect(team?.stripeSubscriptionId).toBeNull();
    expect(team?.subscriptionPlanId).toBe(DEFAULT_PLAN_ID);
  });

  test("leaves a team alone when the banned user is only a member", async () => {
    const ownerId = await seedUser();
    const memberId = await seedUser();
    const teamId = await seedTeam({ ownerId, subscriptionId: "sub_not_theirs" });
    await addMember({ teamId, userId: memberId, roleId: SYSTEM_ROLES_ENUM.MEMBER });

    const result = await banUser({ userId: memberId, ...BAN_INPUT, actorUserId: null });

    expect(result.cancelledSubscriptionCount).toBe(0);
    expect(stripeState.cancelCalls).toHaveLength(0);

    const team = await db.query.teamTable.findFirst({ where: { id: teamId } });
    expect(team?.stripeSubscriptionId).toBe("sub_not_theirs");
  });

  test("other members keep their membership when their team's subscription is cancelled", async () => {
    const ownerId = await seedUser();
    const memberId = await seedUser();
    const teamId = await seedTeam({ ownerId, subscriptionId: "sub_shared" });
    await addMember({ teamId, userId: memberId, roleId: SYSTEM_ROLES_ENUM.MEMBER });

    await banUser({ userId: ownerId, ...BAN_INPUT, actorUserId: null });

    const memberships = await db.query.teamMembershipTable.findMany({ where: { userId: memberId } });
    expect(memberships).toHaveLength(1);
    expect(Boolean(memberships[0]?.isActive)).toBe(true);

    const memberRow = await db.query.userTable.findFirst({ where: { id: memberId } });
    expect(memberRow?.bannedAt).toBeNull();
  });

  test("a Stripe failure still bans the user and enqueues the retry", async () => {
    const userId = await seedUser();
    stripeState.failNext.add("sub_flaky");
    await seedTeam({ ownerId: userId, subscriptionId: "sub_flaky" });

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    const banned = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(banned?.bannedAt).not.toBeNull();
    expect(result.cancelledSubscriptionCount).toBe(1);
    expect(enqueueRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_flaky" }),
    );
  });

  test("a subscription neither Stripe nor the queue took is not counted as cancelled", async () => {
    const userId = await seedUser();
    stripeState.failNext.add("sub_lost");
    await seedTeam({ ownerId: userId, subscriptionId: "sub_lost" });
    enqueueRetryMock.mockRejectedValueOnce(new Error("Queue is unavailable"));

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.cancelledSubscriptionCount).toBe(0);
    expect(result.subscriptionCancellationFailedCount).toBe(1);

    // Nothing cancelled it, so the event must not record one and the notice must not claim one.
    const [event] = await listUserBanEvents({ userId });
    expect(event?.cancelledSubscriptionCount).toBeNull();
  });

  test("one team's Stripe failure does not stop the other team or the rest of the ban", async () => {
    const userId = await seedUser();
    stripeState.failNext.add("sub_bad");
    await seedTeam({ ownerId: userId, subscriptionId: "sub_bad" });
    const goodTeamId = await seedTeam({ ownerId: userId, subscriptionId: "sub_good" });
    await seedApiKey(userId);

    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.revokedApiKeyCount).toBe(1);
    expect(stripeState.cancelCalls.map((call) => call.id).sort()).toEqual(["sub_bad", "sub_good"]);

    const good = await db.query.teamTable.findFirst({ where: { id: goodTeamId } });
    expect(good?.stripeSubscriptionId).toBeNull();
  });
});

describe("the ban notice", () => {
  test("queues one job carrying the external reason verbatim", async () => {
    const userId = await seedUser();

    await banUser({
      userId,
      internalReason: "Card testing from 40+ accounts",
      externalReason: "Repeated chargebacks on this account.",
      sendEmail: true,
      actorUserId: null,
    });

    const emails = queuedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.payload).toMatchObject({
      template: EMAIL_TEMPLATE_TYPES.BAN_NOTICE,
      data: { externalReason: "Repeated chargebacks on this account." },
    });
  });

  test("carries no internal reason: the key is absent, and the text appears nowhere", async () => {
    const userId = await seedUser();
    const internalReason = "ring-leader of the fraud cluster";

    await banUser({ userId, internalReason, externalReason: undefined, sendEmail: true, actorUserId: null });

    const [email] = queuedEmails();
    const data = (email?.payload as { data: Record<string, unknown> }).data;

    expect(Object.keys(data)).not.toContain("internalReason");
    expect(data.externalReason).toBeUndefined();
    expect(JSON.stringify(email)).not.toContain(internalReason);
  });

  test("queues nothing when staff ask for silence", async () => {
    const userId = await seedUser();

    await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(queuedEmails()).toHaveLength(0);
  });

  test("queues nothing, and says so, when the account has no email address", async () => {
    const userId = await seedUser({ email: null });

    const result = await banUser({
      userId,
      internalReason: "Card testing",
      externalReason: undefined,
      sendEmail: true,
      actorUserId: null,
    });

    expect(result.noticeOutcome).toBe("no-email-address");
    expect(queuedEmails()).toHaveLength(0);
  });

  test("re-banning an already banned account appends no event and sends nothing", async () => {
    const userId = await seedUser();
    await banUser({ userId, ...BAN_INPUT, actorUserId: null });
    vi.clearAllMocks();

    const result = await banUser({
      userId,
      internalReason: "Second attempt",
      externalReason: "You should not receive this.",
      sendEmail: true,
      actorUserId: null,
    });

    expect(result.alreadyBanned).toBe(true);
    expect(queuedEmails()).toHaveLength(0);
    expect(await listUserBanEvents({ userId })).toHaveLength(1);
  });

  test("a rejected queue write reports queue-failed and stamps no notice on the event", async () => {
    const userId = await seedUser();
    queueSendMock.mockImplementationOnce(() => {
      throw new Error("Queue is unavailable");
    });

    const result = await banUser({
      userId,
      internalReason: "Card testing",
      externalReason: "Repeated chargebacks.",
      sendEmail: true,
      actorUserId: null,
    });

    expect(result.noticeOutcome).toBe("queue-failed");

    // The ban itself still landed; only the notice failed.
    const banned = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(banned?.bannedAt).not.toBeNull();

    const [event] = await listUserBanEvents({ userId });
    expect(event?.noticeQueuedAt).toBeNull();
  });

  test("renders in English with no link, and escapes an admin-typed reason", async () => {
    const rendered = await renderTransactionalEmail({
      to: "banned@example.com",
      template: EMAIL_TEMPLATE_TYPES.BAN_NOTICE,
      data: {
        username: "Sam",
        externalReason: '<script>alert("x")</script>',
        subscriptionCancelled: true,
      },
    });

    expect(rendered.html).toContain('<html lang="en">');
    expect(rendered.html).not.toContain("<a href");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("subscription");
  });

  test("renders no reason block when the payload carries none", async () => {
    const rendered = await renderTransactionalEmail({
      to: "banned@example.com",
      template: EMAIL_TEMPLATE_TYPES.BAN_NOTICE,
      data: { username: "Sam", subscriptionCancelled: false },
    });

    expect(rendered.html).not.toContain("Reason:");
    expect(rendered.html).not.toContain("blockquote");
  });
});

describe("lifting a ban", () => {
  test("nulls the stamp, appends an event, and leaves the ban event byte-for-byte intact", async () => {
    const userId = await seedUser();
    const adminId = await seedUser({ role: ROLES_ENUM.ADMIN });
    await db.update(userTable).set({ lastName: "Staff" }).where(eq(userTable.id, adminId));
    await banUser({
      userId,
      internalReason: "Card testing",
      externalReason: "Chargebacks.",
      sendEmail: true,
      actorUserId: adminId,
    });

    const [banEvent] = await listUserBanEvents({ userId });
    expect(banEvent.actorUserId).toBe(adminId);
    expect(banEvent.actorName).toBe("Test Staff");

    await unbanUser({
      userId,
      internalReason: "Appeal upheld",
      externalReason: undefined,
      sendEmail: false,
      actorUserId: "admin-2",
    });

    const user = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(user?.bannedAt).toBeNull();

    const events = await listUserBanEvents({ userId });
    expect(events.map((event) => event.action)).toEqual(["unban", "ban"]);
    // "admin-2" has no user row, so the name falls back to null and the UI shows the raw id.
    expect(events[0].actorName).toBeNull();
    expect(events[1]).toEqual(banEvent);
  });

  test("a ban -> unban -> ban cycle keeps all three rounds, first reason included", async () => {
    const userId = await seedUser();

    await banUser({ userId, internalReason: "Round one", externalReason: undefined, sendEmail: false, actorUserId: null });
    await unbanUser({ userId, internalReason: "Appeal", externalReason: undefined, sendEmail: false, actorUserId: null });
    await banUser({ userId, internalReason: "Round two", externalReason: undefined, sendEmail: false, actorUserId: null });

    const events = await listUserBanEvents({ userId });
    expect(events.map((event) => event.action)).toEqual(["ban", "unban", "ban"]);
    expect(events.map((event) => event.internalReason)).toContain("Round one");
  });

  test("unbanning an account that is not banned is a no-op", async () => {
    const userId = await seedUser();

    const result = await unbanUser({
      userId,
      internalReason: "Nothing to lift",
      externalReason: undefined,
      sendEmail: true,
      actorUserId: null,
    });

    expect(result.wasNotBanned).toBe(true);
    expect(queuedEmails()).toHaveLength(0);
    expect(await listUserBanEvents({ userId })).toHaveLength(0);
  });

  test("the notice carries the cancelled-subscription count the ban recorded", async () => {
    const userId = await seedUser();
    await seedTeam({ ownerId: userId, subscriptionId: "sub_owned" });

    await banUser({ userId, ...BAN_INPUT, actorUserId: null });
    vi.clearAllMocks();

    const result = await unbanUser({
      userId,
      internalReason: "Appeal upheld",
      externalReason: undefined,
      sendEmail: true,
      actorUserId: null,
    });

    expect(result.cancelledSubscriptionCount).toBe(1);
    const [email] = queuedEmails();
    expect(email?.payload).toMatchObject({
      template: EMAIL_TEMPLATE_TYPES.UNBAN_NOTICE,
      data: { cancelledSubscriptionCount: 1 },
    });
  });

  test("queues nothing when staff ask for silence", async () => {
    const userId = await seedUser();
    await banUser({ userId, ...BAN_INPUT, actorUserId: null });
    vi.clearAllMocks();

    await unbanUser({
      userId,
      internalReason: "Appeal upheld",
      externalReason: undefined,
      sendEmail: false,
      actorUserId: null,
    });

    expect(queuedEmails()).toHaveLength(0);
  });

  test("the unban notice names what did not come back", async () => {
    const rendered = await renderTransactionalEmail({
      to: "restored@example.com",
      template: EMAIL_TEMPLATE_TYPES.UNBAN_NOTICE,
      data: { username: "Sam", cancelledSubscriptionCount: 2 },
    });

    expect(rendered.html).toContain('<html lang="en">');
    expect(rendered.html).not.toContain("<a href");
    expect(rendered.text).toContain("API keys");
    expect(rendered.text).toContain("subscription");
  });
});

describe("re-banning, and two bans at once", () => {
  test("a second ban repairs the session delete the first one failed", async () => {
    const userId = await seedUser();
    const sessionKey = await seedSession(userId);
    sessionState.failDeletes = 1;

    const first = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(first.alreadyBanned).toBe(false);
    // The ban landed, but the session it could not delete still authenticates.
    expect(await env.KV_STORE.get(sessionKey)).not.toBeNull();

    const second = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(second.alreadyBanned).toBe(true);
    expect(await env.KV_STORE.get(sessionKey)).toBeNull();
    // Repaired, not recorded again: the history stays one ban.
    expect(await listUserBanEvents({ userId })).toHaveLength(1);
  });

  test("a repeat ban revokes a key created after the first one", async () => {
    const userId = await seedUser();
    await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    const { secret } = await seedApiKey(userId);
    const result = await banUser({ userId, ...BAN_INPUT, actorUserId: null });

    expect(result.alreadyBanned).toBe(true);
    expect(result.revokedApiKeyCount).toBe(1);
    expect(await getApiKeyPrincipal(secret)).toBeNull();
  });

  test("two concurrent bans write exactly one event and one stamp", async () => {
    const userId = await seedUser();

    const results = await Promise.all([
      banUser({ userId, internalReason: "Race one", externalReason: undefined, sendEmail: true, actorUserId: null }),
      banUser({ userId, internalReason: "Race two", externalReason: undefined, sendEmail: true, actorUserId: null }),
    ]);

    expect(results.filter((result) => !result.alreadyBanned)).toHaveLength(1);
    expect(await listUserBanEvents({ userId })).toHaveLength(1);
    // Only the winner tells the account holder, so the loser cannot double the notice.
    expect(queuedEmails()).toHaveLength(1);

    const banned = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(banned?.bannedAt).not.toBeNull();
    // The loser reports the stamp the winner wrote rather than one of its own.
    expect(results.every((result) => result.bannedAt instanceof Date)).toBe(true);
  });
});

describe("refusals", () => {
  test("banning an admin is refused; the account is untouched", async () => {
    const userId = await seedUser({ role: ROLES_ENUM.ADMIN });

    await expect(banUser({ userId, ...BAN_INPUT, actorUserId: null })).rejects.toThrow();

    const user = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(user?.bannedAt).toBeNull();
    expect(await db.query.userBanEventTable.findMany({ where: { userId } })).toHaveLength(0);
  });

  test("banning yourself is refused", async () => {
    const userId = await seedUser();

    await expect(banUser({ userId, ...BAN_INPUT, actorUserId: userId })).rejects.toThrow();

    const user = await db.query.userTable.findFirst({ where: { id: userId } });
    expect(user?.bannedAt).toBeNull();
  });
});
