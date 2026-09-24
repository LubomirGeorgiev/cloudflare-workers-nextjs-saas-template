import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Stripe from "stripe";

import { TEAMS_DASHBOARD_PATH } from "@/constants";
import { AVAILABLE_BILLING_INTERVALS, PAID_PLAN_IDS, TEAM_PLANS } from "@/constants/plans";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { ActionError } from "@/lib/action-error";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

const TEAM = { id: "team-1", slug: "acme", stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123" };
const [PLAN_ID] = PAID_PLAN_IDS;
const TRIAL_PLAN_ID = PAID_PLAN_IDS.find((planId) => (TEAM_PLANS[planId].trialDays ?? 0) > 0);
const [INTERVAL] = AVAILABLE_BILLING_INTERVALS;
const INVOICE_SUBSCRIPTION = {
  id: "sub_123",
  latest_invoice: { confirmation_secret: { client_secret: "pi_123_secret_abc" } },
};

const {
  completeTrialSubscriptionMock,
  createPortalSessionMock,
  createSetupIntentMock,
  createSubscriptionMock,
  findTeamMock,
  getLocaleMock,
  headersMock,
  isBillingEnabledMock,
  retrieveSubscriptionMock,
} = vi.hoisted(() => ({
  completeTrialSubscriptionMock: vi.fn(),
  createPortalSessionMock: vi.fn(async () => ({ url: "https://billing.stripe.test/session" })),
  createSetupIntentMock: vi.fn(async () => ({ client_secret: "seti_123_secret_abc" })),
  createSubscriptionMock: vi.fn(),
  findTeamMock: vi.fn(),
  getLocaleMock: vi.fn(),
  headersMock: vi.fn(async () => new Headers()),
  isBillingEnabledMock: vi.fn(() => true),
  retrieveSubscriptionMock: vi.fn(),
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
    subscriptions: { create: createSubscriptionMock, retrieve: retrieveSubscriptionMock },
  }),
}));
vi.mock("@/flags", () => ({ isBillingEnabled: isBillingEnabledMock }));
vi.mock("@/i18n/server", () => ({ getLocale: getLocaleMock }));
vi.mock("@/utils/plan-prices", () => ({ getAddonPriceId: vi.fn(), getPlanPriceId: vi.fn(() => "price_123") }));
vi.mock("@/utils/team-subscription", () => ({
  claimTeamSubscription: vi.fn(async () => true),
  ensureStripeCustomer: vi.fn(async () => TEAM.stripeCustomerId),
  isTrialEligible: vi.fn(async () => true),
  reconcileTeamFromSubscription: vi.fn(),
  settleRecordedSubscription: vi.fn(),
}));
vi.mock("@/lib/teams/trial-subscription", () => ({ completeTrialSubscription: completeTrialSubscriptionMock }));

// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { BILLING: { identifier: "billing", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const {
  completeTrialAction,
  createBillingPortalSessionAction,
  createSubscriptionAction,
  resumePaymentAction,
  startTrialSetupAction,
} = await import("./billing.actions");

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
