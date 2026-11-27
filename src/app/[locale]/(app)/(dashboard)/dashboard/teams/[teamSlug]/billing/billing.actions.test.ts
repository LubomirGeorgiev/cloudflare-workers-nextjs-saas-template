import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Stripe from "stripe";

import { EU_WITHDRAWAL_ENABLED, TEAMS_DASHBOARD_PATH } from "@/constants";
import { TEAM_ADDON_IDS, TEAM_ADDONS } from "@/constants/addons";
import { AVAILABLE_BILLING_INTERVALS, PAID_PLAN_IDS, TEAM_PLAN_LIMIT_KEYS, TEAM_PLANS } from "@/constants/plans";
import {
  cancelParamsForStatus,
  STRIPE_SUBSCRIPTION_TRANSITION_POLICY,
} from "@/constants/subscription-lifecycle";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { ActionError } from "@/lib/action-error";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import { toStoredLimitOverrides } from "@/schemas/limit-overrides.schema";

const TEAM = { id: "team-1", slug: "acme", stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123" };
const [PLAN_ID] = PAID_PLAN_IDS;
const TRIAL_PLAN_ID = PAID_PLAN_IDS.find((planId) => (TEAM_PLANS[planId].trialDays ?? 0) > 0);
const [INTERVAL] = AVAILABLE_BILLING_INTERVALS;
const SUBSCRIPTION_POLICY_ENTRIES = Object.entries(STRIPE_SUBSCRIPTION_TRANSITION_POLICY);
const CLEARED_STATUSES = SUBSCRIPTION_POLICY_ENTRIES
  .filter(([, policy]) => policy.subscription === "clear")
  .map(([status]) => status);
const NO_PAID_ACCESS_STATUSES = SUBSCRIPTION_POLICY_ENTRIES
  .filter(([, policy]) => !policy.grantsPaidAccess)
  .map(([status]) => status);
const PAID_ACCESS_STATUSES = SUBSCRIPTION_POLICY_ENTRIES
  .filter(([, policy]) => policy.grantsPaidAccess)
  .map(([status]) => status);
const RETAINED_NO_ACCESS_STATUSES = SUBSCRIPTION_POLICY_ENTRIES
  .filter(([, policy]) => policy.subscription === "retain" && !policy.grantsPaidAccess)
  .map(([status]) => status);
const INVOICE_SUBSCRIPTION = {
  id: "sub_123",
  status: "incomplete",
  latest_invoice: { confirmation_secret: { client_secret: "pi_123_secret_abc" } },
};

const {
  cancelSubscriptionMock,
  completeTrialSubscriptionMock,
  createPortalSessionMock,
  createSetupIntentMock,
  createSubscriptionMock,
  findTeamMock,
  getLocaleMock,
  headersMock,
  isBillingEnabledMock,
  recordCheckoutConsentMock,
  resolveSubscriptionPriceMock,
  retrieveSubscriptionMock,
  updateSubscriptionMock,
} = vi.hoisted(() => ({
  cancelSubscriptionMock: vi.fn(async (id: string) => ({ id, status: "canceled" })),
  completeTrialSubscriptionMock: vi.fn(),
  createPortalSessionMock: vi.fn(async () => ({ url: "https://billing.stripe.test/session" })),
  createSetupIntentMock: vi.fn(async () => ({ client_secret: "seti_123_secret_abc" })),
  createSubscriptionMock: vi.fn(),
  findTeamMock: vi.fn(),
  getLocaleMock: vi.fn(),
  headersMock: vi.fn(async () => new Headers()),
  isBillingEnabledMock: vi.fn(() => true),
  recordCheckoutConsentMock: vi.fn(async () => undefined),
  resolveSubscriptionPriceMock: vi.fn((): unknown => null),
  retrieveSubscriptionMock: vi.fn(),
  updateSubscriptionMock: vi.fn(async (id: string) => ({ id, status: "active", cancel_at_period_end: true })),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: headersMock }));

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
vi.mock("@/utils/team-auth", () => ({
  requireTeamPermission: vi.fn(async () => ({ user: { id: "user-1", email: "owner@example.com" } })),
}));
vi.mock("@/lib/billing/team-billing", () => ({ getTeamBillingSummary: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    billingPortal: { sessions: { create: createPortalSessionMock } },
    setupIntents: { create: createSetupIntentMock },
    subscriptions: {
      cancel: cancelSubscriptionMock,
      create: createSubscriptionMock,
      retrieve: retrieveSubscriptionMock,
      update: updateSubscriptionMock,
    },
  }),
}));
vi.mock("@/flags", () => ({ isBillingEnabled: isBillingEnabledMock }));
vi.mock("@/i18n/server", () => ({ getLocale: getLocaleMock }));
vi.mock("@/utils/plan-prices", () => ({
  getAddonPriceId: vi.fn(() => "price_addon"),
  getPlanPriceId: vi.fn(() => "price_123"),
  resolveSubscriptionPrice: resolveSubscriptionPriceMock,
}));
vi.mock("@/utils/team-subscription", () => ({
  claimTeamSubscription: vi.fn(async () => true),
  ensureStripeCustomer: vi.fn(async () => TEAM.stripeCustomerId),
  isTrialEligible: vi.fn(async () => true),
  reconcileTeamFromSubscription: vi.fn(),
  settleRecordedSubscription: vi.fn(),
}));
vi.mock("@/lib/teams/trial-subscription", () => ({ completeTrialSubscription: completeTrialSubscriptionMock }));
vi.mock("@/lib/billing/checkout-consent", () => ({ recordCheckoutConsent: recordCheckoutConsentMock }));

// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { BILLING: { identifier: "billing", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const {
  cancelSubscriptionAction,
  changePlanAction,
  completeTrialAction,
  createBillingPortalSessionAction,
  createSubscriptionAction,
  recordCheckoutConsentAction,
  resumePaymentAction,
  resumeSubscriptionAction,
  startTrialSetupAction,
  updateAddonQuantityAction,
} = await import("./billing.actions");
const { reconcileTeamFromSubscription } = await import("@/utils/team-subscription");

function expectedReturnUrl({ locale, baseUrl }: { locale: Locale; baseUrl?: string }): string {
  return absoluteLocalizedUrl({ pathname: `${TEAMS_DASHBOARD_PATH}/${TEAM.slug}/billing`, locale, baseUrl });
}

describe("createBillingPortalSessionAction", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
  });

  afterEach(() => {
    vi.clearAllMocks();
    isBillingEnabledMock.mockReturnValue(true);
    headersMock.mockResolvedValue(new Headers());
  });

  // Stripe sends the user back to this URL; a bare path would let the proxy pick another locale.
  test.each(ENABLED_LOCALES)("returns to the team billing page in the request locale (%s)", async (locale) => {
    getLocaleMock.mockResolvedValue(locale);

    await createBillingPortalSessionAction({ teamId: TEAM.id });

    expect(createPortalSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: TEAM.stripeCustomerId, locale, return_url: expectedReturnUrl({ locale }) }),
    );
  });

  test("returns to the host that served the request", async () => {
    const [locale] = ENABLED_LOCALES;
    const previewOrigin = "https://preview-123.example-preview.test";
    getLocaleMock.mockResolvedValue(locale);
    headersMock.mockResolvedValue(new Headers({ origin: previewOrigin }));

    await createBillingPortalSessionAction({ teamId: TEAM.id });

    const returnUrl = expectedReturnUrl({ locale, baseUrl: previewOrigin });
    expect(returnUrl.startsWith(`${previewOrigin}/`)).toBe(true);
    expect(createPortalSessionMock).toHaveBeenCalledWith(expect.objectContaining({ return_url: returnUrl }));
  });

  test("refuses without a portal session when billing is disabled", async () => {
    isBillingEnabledMock.mockReturnValue(false);

    await expect(createBillingPortalSessionAction({ teamId: TEAM.id })).rejects.toThrow();
    expect(createPortalSessionMock).not.toHaveBeenCalled();
  });
});

// The browser builds the Payment Element's return_url (see buildPaymentReturnUrl), so these
// actions hand out only the client secret.
describe("checkout actions", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
    createSubscriptionMock.mockResolvedValue(INVOICE_SUBSCRIPTION);
    retrieveSubscriptionMock.mockResolvedValue(INVOICE_SUBSCRIPTION);
  });

  afterEach(() => {
    vi.clearAllMocks();
    isBillingEnabledMock.mockReturnValue(true);
  });

  describe.skipIf(!PLAN_ID)("createSubscriptionAction", () => {
    test("returns the invoice client secret", async () => {
      const result = await createSubscriptionAction({ teamId: TEAM.id, planId: PLAN_ID, interval: INTERVAL });

      expect(result).toEqual({
        success: true,
        clientSecret: INVOICE_SUBSCRIPTION.latest_invoice.confirmation_secret.client_secret,
        subscriptionId: INVOICE_SUBSCRIPTION.id,
      });
    });

    test("refuses without a subscription when billing is disabled", async () => {
      isBillingEnabledMock.mockReturnValue(false);

      await expect(createSubscriptionAction({ teamId: TEAM.id, planId: PLAN_ID, interval: INTERVAL })).rejects.toThrow();
      expect(createSubscriptionMock).not.toHaveBeenCalled();
    });
  });

  describe.skipIf(!TRIAL_PLAN_ID)("startTrialSetupAction", () => {
    // completeTrialSubscription reads the plan and interval back from this metadata.
    test("stamps the team, plan, and interval on the SetupIntent", async () => {
      const trial = { planId: TRIAL_PLAN_ID!, interval: INTERVAL };

      const result = await startTrialSetupAction({ teamId: TEAM.id, ...trial });

      expect(createSetupIntentMock).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { teamId: TEAM.id, ...trial } }),
      );
      expect(result).toEqual({ success: true, clientSecret: "seti_123_secret_abc" });
    });

    test("refuses without a SetupIntent when billing is disabled", async () => {
      isBillingEnabledMock.mockReturnValue(false);

      await expect(startTrialSetupAction({ teamId: TEAM.id, planId: TRIAL_PLAN_ID!, interval: INTERVAL })).rejects.toThrow();
      expect(createSetupIntentMock).not.toHaveBeenCalled();
    });
  });

  describe("resumePaymentAction", () => {
    test("returns the open invoice client secret", async () => {
      const result = await resumePaymentAction({ teamId: TEAM.id });

      expect(result).toEqual({
        success: true,
        clientSecret: INVOICE_SUBSCRIPTION.latest_invoice.confirmation_secret.client_secret,
      });
    });

    test("refuses without a Stripe read when billing is disabled", async () => {
      isBillingEnabledMock.mockReturnValue(false);

      await expect(resumePaymentAction({ teamId: TEAM.id })).rejects.toThrow();
      expect(retrieveSubscriptionMock).not.toHaveBeenCalled();
    });

    // A paid invoice still has a client secret, but the Payment Element cannot load it.
    test("saves the live status and refuses when nothing is due", async () => {
      const paid = { ...INVOICE_SUBSCRIPTION, status: "active" };
      retrieveSubscriptionMock.mockResolvedValue(paid);

      await expect(resumePaymentAction({ teamId: TEAM.id })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        messageKey: "Client.Dashboard.Billing.errorNoOpenPayment",
      });
      expect(reconcileTeamFromSubscription).toHaveBeenCalledWith({ subscription: paid });
    });
  });
});

describe("changePlanAction", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status: "active", items: { data: [] } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The confirm dialog in plan-cards.tsx describes Stripe prorations, and the toast names the new plan.
  test("prorates the change and returns the new plan and interval", async () => {
    const result = await changePlanAction({ teamId: TEAM.id, planId: PLAN_ID, interval: INTERVAL });

    expect(result).toEqual({ success: true, planId: PLAN_ID, interval: INTERVAL });
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      TEAM.stripeSubscriptionId,
      expect.objectContaining({ proration_behavior: "create_prorations" }),
    );
  });
});

// From the catalog, so a fork passes: an add-on that grants a limit, and an override on each such limit.
const GRANTING_ADDON_ID = TEAM_ADDON_IDS.find((addonId) => TEAM_PLAN_LIMIT_KEYS.some((key) => (TEAM_ADDONS[addonId].limits?.[key] ?? 0) > 0));

describe.skipIf(!GRANTING_ADDON_ID)("updateAddonQuantityAction", () => {
  const addonId = GRANTING_ADDON_ID ?? "";
  const grantedKeys = TEAM_PLAN_LIMIT_KEYS.filter((key) => (TEAM_ADDONS[addonId]?.limits?.[key] ?? 0) > 0);
  // Hidden from the customer: the refusal must hold, and its copy must not name the override.
  const overridingTeam = {
    ...TEAM,
    subscriptionPlanId: PLAN_ID,
    subscriptionStatus: "active",
    planExpiresAt: null,
    subscriptionAddonIds: null,
    limitOverrides: toStoredLimitOverrides({
      limits: Object.fromEntries(grantedKeys.map((key) => [key, TEAM_PLANS[PLAN_ID].limits[key]])),
      hideFromCustomer: true,
    }),
  };

  beforeEach(() => {
    findTeamMock.mockResolvedValue(overridingTeam);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("refuses more units when staff overrides set every limit the add-on grants", async () => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status: "active", items: { data: [] } });

    await expect(updateAddonQuantityAction({ teamId: TEAM.id, addonId, quantity: 1 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", messageKey: "Client.Dashboard.Billing.errorAddonIncreaseUnavailable" });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  test("still lets the team remove units that add nothing", async () => {
    resolveSubscriptionPriceMock.mockReturnValue({ kind: "addon", addonId });
    retrieveSubscriptionMock.mockResolvedValue({
      id: TEAM.stripeSubscriptionId,
      status: "active",
      items: { data: [{ id: "si_addon", price: { id: "price_addon" }, quantity: 2 }] },
    });

    await updateAddonQuantityAction({ teamId: TEAM.id, addonId, quantity: 1 });

    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      TEAM.stripeSubscriptionId,
      expect.objectContaining({ items: [{ id: "si_addon", quantity: 1 }] }),
    );
  });

  // One item holds 1 unit and a duplicate holds 2: a change to 2 units is a decrease from 3.
  test("counts duplicate items, so a decrease below their sum is no blocked increase", async () => {
    resolveSubscriptionPriceMock.mockReturnValue({ kind: "addon", addonId });
    retrieveSubscriptionMock.mockResolvedValue({
      id: TEAM.stripeSubscriptionId,
      status: "active",
      items: {
        data: [
          { id: "si_addon", price: { id: "price_addon" }, quantity: 1 },
          { id: "si_addon_duplicate", price: { id: "price_addon_duplicate" }, quantity: 2 },
        ],
      },
    });

    await updateAddonQuantityAction({ teamId: TEAM.id, addonId, quantity: 2 });

    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      TEAM.stripeSubscriptionId,
      expect.objectContaining({ items: [{ id: "si_addon", quantity: 2 }, { id: "si_addon_duplicate", deleted: true }] }),
    );
  });

  test("allows more units when no override sets the add-on's limits", async () => {
    findTeamMock.mockResolvedValue({ ...overridingTeam, limitOverrides: null });
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status: "active", items: { data: [] } });

    await updateAddonQuantityAction({ teamId: TEAM.id, addonId, quantity: 1 });

    expect(updateSubscriptionMock).toHaveBeenCalledOnce();
  });
});

describe("cancelSubscriptionAction", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("cancels a past_due subscription now", async () => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status: "past_due" });

    const result = await cancelSubscriptionAction({ teamId: TEAM.id, atPeriodEnd: false });

    expect(result).toEqual({ success: true, canceledNow: true });
    expect(cancelSubscriptionMock).toHaveBeenCalledWith(TEAM.stripeSubscriptionId, expect.anything());
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  // A lost webhook can leave past_due on the page while Stripe already says active.
  test("cancels at period end when Stripe says the subscription is active", async () => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status: "active" });

    const result = await cancelSubscriptionAction({ teamId: TEAM.id, atPeriodEnd: false });

    expect(result).toEqual({ success: true, canceledNow: false });
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
    expect(updateSubscriptionMock).toHaveBeenCalledWith(TEAM.stripeSubscriptionId, { cancel_at_period_end: true });
  });

  // Stripe refuses an update on an ended subscription, so the action only syncs the stale row.
  test.each(CLEARED_STATUSES)("syncs the row without a Stripe write when Stripe says %s", async (status) => {
    const current = { id: TEAM.stripeSubscriptionId, status };
    retrieveSubscriptionMock.mockResolvedValue(current);

    const result = await cancelSubscriptionAction({ teamId: TEAM.id, atPeriodEnd: false });

    expect(result).toEqual({ success: true, canceledNow: true });
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(reconcileTeamFromSubscription).toHaveBeenCalledWith({ subscription: current });
  });

  test.each(RETAINED_NO_ACCESS_STATUSES)("cancels now when Stripe says %s", async (status) => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status });

    const result = await cancelSubscriptionAction({ teamId: TEAM.id, atPeriodEnd: false });

    expect(result).toEqual({ success: true, canceledNow: true });
    expect(cancelSubscriptionMock).toHaveBeenCalledWith(TEAM.stripeSubscriptionId, cancelParamsForStatus(status));
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });
});

// The plan card shows resume only for a scheduled cancel (see selectPlanCardAction).
describe("resumeSubscriptionAction", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // cancelSubscriptionAction schedules the cancel with `cancel_at_period_end: true`.
  test.each(PAID_ACCESS_STATUSES)("clears the scheduled cancel of a %s subscription", async (status) => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status, cancel_at_period_end: true });
    const updated = { id: TEAM.stripeSubscriptionId, status, cancel_at_period_end: false };
    updateSubscriptionMock.mockResolvedValueOnce(updated);

    await expect(resumeSubscriptionAction({ teamId: TEAM.id })).resolves.toEqual({ success: true });

    expect(updateSubscriptionMock).toHaveBeenCalledWith(TEAM.stripeSubscriptionId, { cancel_at_period_end: false });
    expect(reconcileTeamFromSubscription).toHaveBeenCalledWith({ subscription: updated });
  });

  test("saves the live state and refuses when no cancel is scheduled", async () => {
    const current = { id: TEAM.stripeSubscriptionId, status: PAID_ACCESS_STATUSES[0], cancel_at_period_end: false };
    retrieveSubscriptionMock.mockResolvedValue(current);

    await expect(resumeSubscriptionAction({ teamId: TEAM.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      messageKey: "Client.Dashboard.Billing.errorNothingToResume",
    });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(reconcileTeamFromSubscription).toHaveBeenCalledWith({ subscription: current });
  });

  test.each(NO_PAID_ACCESS_STATUSES)("refuses without a Stripe write when Stripe says %s", async (status) => {
    retrieveSubscriptionMock.mockResolvedValue({ id: TEAM.stripeSubscriptionId, status, cancel_at_period_end: true });

    await expect(resumeSubscriptionAction({ teamId: TEAM.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      messageKey: "Client.Dashboard.Billing.errorNothingToResume",
    });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });
});

// The client keeps the return query only for a retryable code (see classifyTrialCompletionFailure).
describe("completeTrialAction", () => {
  const TRIAL_INPUT = { teamId: TEAM.id, setupIntentId: "seti_123" };

  afterEach(() => {
    vi.restoreAllMocks();
    completeTrialSubscriptionMock.mockReset();
  });

  test("returns success once the service starts the trial", async () => {
    completeTrialSubscriptionMock.mockResolvedValue(undefined);

    await expect(completeTrialAction(TRIAL_INPUT)).resolves.toEqual({ success: true });
  });

  // The service maps a Stripe rejection of the payment method to this final refusal.
  test("passes the payment method refusal through unchanged", async () => {
    const refusal = new ActionError("PRECONDITION_FAILED", {
      key: "Client.Dashboard.Billing.errorTrialPaymentMethodUnsupported",
    });
    completeTrialSubscriptionMock.mockRejectedValue(refusal);

    await expect(completeTrialAction(TRIAL_INPUT)).rejects.toBe(refusal);
  });

  // Stripe may still have created the subscription, so the client must be able to retry.
  test.each([
    ["StripeConnectionError", Stripe.errors.StripeConnectionError],
    ["StripeAPIError", Stripe.errors.StripeAPIError],
    ["StripeRateLimitError", Stripe.errors.StripeRateLimitError],
  ])("keeps an ambiguous %s retryable", async (_name, ErrorClass) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    completeTrialSubscriptionMock.mockRejectedValue(new ErrorClass({ message: "test" }));

    await expect(completeTrialAction(TRIAL_INPUT)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      messageKey: "Client.Dashboard.Billing.errorPaymentProvider",
    });
  });
});

describe("recordCheckoutConsentAction", () => {
  beforeEach(() => {
    getLocaleMock.mockResolvedValue(ENABLED_LOCALES[0]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    isBillingEnabledMock.mockReturnValue(true);
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("records the consent for the acting user in the request locale", async () => {
    const result = await recordCheckoutConsentAction({ teamId: TEAM.id, immediateStart: true, setupIntentId: "seti_123" });

    expect(result).toEqual({ success: true });
    expect(recordCheckoutConsentMock).toHaveBeenCalledWith({
      teamId: TEAM.id,
      userId: "user-1",
      immediateStart: true,
      setupIntentId: "seti_123",
      locale: ENABLED_LOCALES[0],
    });
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("refuses when billing is disabled", async () => {
    isBillingEnabledMock.mockReturnValue(false);

    await expect(recordCheckoutConsentAction({ teamId: TEAM.id, immediateStart: true })).rejects.toThrow();
    expect(recordCheckoutConsentMock).not.toHaveBeenCalled();
  });

  test.skipIf(!EU_WITHDRAWAL_ENABLED)("hides a provider failure behind a stable error", async () => {
    recordCheckoutConsentMock.mockRejectedValueOnce(new Error("network"));

    await expect(recordCheckoutConsentAction({ teamId: TEAM.id, immediateStart: false })).rejects.toBeInstanceOf(ActionError);
  });

  // With the flag off the form never calls it; a direct call writes nothing to Stripe.
  test.skipIf(EU_WITHDRAWAL_ENABLED)("refuses while the EU withdrawal flow is disabled", async () => {
    await expect(recordCheckoutConsentAction({ teamId: TEAM.id, immediateStart: true })).rejects.toBeInstanceOf(ActionError);
    expect(recordCheckoutConsentMock).not.toHaveBeenCalled();
  });
});
