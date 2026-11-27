import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EU_WITHDRAWAL_ENABLED } from "@/constants";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { WITHDRAWAL_STALE_MESSAGE_KEY } from "@/constants/eu-withdrawal";
import { ActionError } from "@/lib/action-error";

const TEAM = { id: "team-1", name: "Acme", subscriptionPlanId: null, stripeSubscriptionId: "sub_123" };
const SESSION_USER = { id: "user-1", email: "ana@example.com", firstName: "Ana", lastName: "Ruiz" };
const INPUT = { teamId: TEAM.id, subscriptionId: TEAM.stripeSubscriptionId };

const { findTeamMock, isBillingEnabledMock, requireTeamPermissionMock, withdrawFromContractMock } = vi.hoisted(() => ({
  findTeamMock: vi.fn(),
  isBillingEnabledMock: vi.fn(() => true),
  requireTeamPermissionMock: vi.fn(),
  withdrawFromContractMock: vi.fn(async () => ({ completed: true })),
}));

vi.mock("server-only", () => ({}));

const actionClientMock = {
  action: (handler: (args: { parsedInput: unknown }) => unknown) => {
    return (input?: unknown) => handler({ parsedInput: input });
  },
  inputSchema() {
    return actionClientMock;
  },
  metadata() {
    return actionClientMock;
  },
};

vi.mock("@/lib/safe-action", () => ({ actionClient: actionClientMock }));
vi.mock("@/db", () => ({ getDB: () => ({ query: { teamTable: { findFirst: findTeamMock } } }) }));
vi.mock("@/utils/team-auth", () => ({ requireTeamPermission: requireTeamPermissionMock }));
vi.mock("@/flags", () => ({ isBillingEnabled: isBillingEnabledMock }));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(async () => DEFAULT_LOCALE) }));
vi.mock("@/lib/billing/eu-withdrawal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/billing/eu-withdrawal")>(),
  withdrawFromContract: withdrawFromContractMock,
}));
// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { BILLING: { identifier: "billing", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const { withdrawFromContractAction } = await import("./withdrawal.actions");
const { withdrawalSignerName } = await import("@/lib/billing/eu-withdrawal");

describe("withdrawFromContractAction", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
    requireTeamPermissionMock.mockResolvedValue({ user: SESSION_USER });
  });

  afterEach(() => {
    vi.clearAllMocks();
    isBillingEnabledMock.mockReturnValue(true);
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("withdraws the team's subscription as the signed-in user", async () => {
    await expect(withdrawFromContractAction(INPUT)).resolves.toEqual({ completed: true });

    expect(requireTeamPermissionMock).toHaveBeenCalledWith(TEAM.id, expect.any(String));
    expect(withdrawFromContractMock).toHaveBeenCalledWith(expect.objectContaining({
      team: TEAM,
      subscriptionId: TEAM.stripeSubscriptionId,
      actingUser: {
        id: SESSION_USER.id,
        name: withdrawalSignerName(SESSION_USER),
        email: SESSION_USER.email,
        locale: DEFAULT_LOCALE,
      },
    }));
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("refuses a team with no subscription", async () => {
    findTeamMock.mockResolvedValue({ ...TEAM, stripeSubscriptionId: null });

    await expect(withdrawFromContractAction(INPUT)).rejects.toBeInstanceOf(ActionError);
    expect(withdrawFromContractMock).not.toHaveBeenCalled();
  });

  // The owner withdrew in another tab and subscribed again: the old dialog must not end the new contract.
  test.skipIf(!EU_WITHDRAWAL_ENABLED)("refuses a dialog that showed a subscription that another one replaced", async () => {
    findTeamMock.mockResolvedValue({ ...TEAM, stripeSubscriptionId: "sub_new" });

    await expect(withdrawFromContractAction(INPUT)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: WITHDRAWAL_STALE_MESSAGE_KEY,
    });
    expect(withdrawFromContractMock).not.toHaveBeenCalled();
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("refuses while billing is off", async () => {
    isBillingEnabledMock.mockReturnValue(false);

    await expect(withdrawFromContractAction(INPUT)).rejects.toBeInstanceOf(ActionError);
    expect(withdrawFromContractMock).not.toHaveBeenCalled();
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("hides an unexpected failure behind the provider error", async () => {
    withdrawFromContractMock.mockRejectedValueOnce(new Error("Stripe is unavailable"));
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);

    await expect(withdrawFromContractAction(INPUT)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  test.skipIf(EU_WITHDRAWAL_ENABLED)("refuses before any check while the feature is off", async () => {
    await expect(withdrawFromContractAction(INPUT)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(requireTeamPermissionMock).not.toHaveBeenCalled();
    expect(withdrawFromContractMock).not.toHaveBeenCalled();
  });
});
