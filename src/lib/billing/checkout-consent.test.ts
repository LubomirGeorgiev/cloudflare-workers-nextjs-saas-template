import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SUBSCRIPTION_WITHDRAWAL_METADATA, WITHDRAWAL_PERIOD_DAYS } from "@/constants/eu-withdrawal";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { ActionError } from "@/lib/action-error";
import { buildCheckoutConsentMetadata } from "@/lib/billing/eu-withdrawal-selectors";

const TEAM = { id: "team-1", stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123" };
const NOW = new Date("2026-03-01T10:00:00.000Z");
const INCOMPLETE_SUBSCRIPTION = {
  id: TEAM.stripeSubscriptionId,
  status: "incomplete",
  customer: TEAM.stripeCustomerId,
  metadata: { teamId: TEAM.id },
  latest_invoice: {
    id: "in_123",
    payments: { data: [{ is_default: true, payment: { type: "payment_intent", payment_intent: "pi_123" } }] },
  },
};

const {
  findTeamMock,
  retrievePaymentIntentMock,
  retrieveSetupIntentMock,
  retrieveSubscriptionMock,
  updateSetupIntentMock,
  updateSubscriptionMock,
} = vi.hoisted(() => ({
  findTeamMock: vi.fn(),
  retrievePaymentIntentMock: vi.fn(),
  retrieveSetupIntentMock: vi.fn(),
  retrieveSubscriptionMock: vi.fn(),
  updateSetupIntentMock: vi.fn(async () => ({})),
  updateSubscriptionMock: vi.fn(async () => ({})),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDB: () => ({ query: { teamTable: { findFirst: findTeamMock } } }) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: async () => ({
    paymentIntents: { retrieve: retrievePaymentIntentMock },
    setupIntents: { retrieve: retrieveSetupIntentMock, update: updateSetupIntentMock },
    subscriptions: { retrieve: retrieveSubscriptionMock, update: updateSubscriptionMock },
  }),
}));

const { recordCheckoutConsent } = await import("./checkout-consent");

describe("recordCheckoutConsent", () => {
  beforeEach(() => {
    findTeamMock.mockResolvedValue(TEAM);
    retrieveSubscriptionMock.mockResolvedValue(INCOMPLETE_SUBSCRIPTION);
    retrievePaymentIntentMock.mockResolvedValue({ id: "pi_123", status: "requires_payment_method" });
    retrieveSetupIntentMock.mockResolvedValue({
      id: "seti_123",
      status: "requires_payment_method",
      customer: TEAM.stripeCustomerId,
      metadata: { teamId: TEAM.id },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // The record must hold the words the buyer saw, in the buyer's language, rendered on the server.
  test.each(LOCALES)("stores the %s consent text on the incomplete subscription", async (locale) => {
    const t = await getTranslator({ locale, namespace: "Client.Dashboard.Billing" });

    await recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: true, locale, now: NOW });

    expect(updateSubscriptionMock).toHaveBeenCalledWith(TEAM.stripeSubscriptionId, {
      metadata: buildCheckoutConsentMetadata({
        immediateStart: true,
        userId: "user-1",
        at: NOW,
        locale,
        text: t("immediateStartConsent", { days: WITHDRAWAL_PERIOD_DAYS }),
      }),
    });
    expect(updateSetupIntentMock).not.toHaveBeenCalled();
  });

  test("an unticked box clears the consent keys and keeps the ordering user", async () => {
    await recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: false, locale: DEFAULT_LOCALE, now: NOW });

    const [, { metadata }] = updateSubscriptionMock.mock.calls[0] as unknown as [string, { metadata: Record<string, string> }];
    expect(metadata[SUBSCRIPTION_WITHDRAWAL_METADATA.orderUserId]).toBe("user-1");
    expect(metadata[SUBSCRIPTION_WITHDRAWAL_METADATA.consentText]).toBe("");
  });

  test("stores a trial consent on the team's own SetupIntent", async () => {
    await recordCheckoutConsent({
      teamId: TEAM.id,
      userId: "user-1",
      immediateStart: true,
      setupIntentId: "seti_123",
      locale: DEFAULT_LOCALE,
      now: NOW,
    });

    expect(updateSetupIntentMock).toHaveBeenCalledWith("seti_123", { metadata: expect.objectContaining({
      [SUBSCRIPTION_WITHDRAWAL_METADATA.consentAt]: NOW.toISOString(),
    }) });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  test.each([
    { name: "a running subscription", fields: { status: "active" } },
    { name: "another customer's subscription", fields: { customer: "cus_other" } },
    { name: "another team's subscription", fields: { metadata: { teamId: "team-2" } } },
    { name: "a checkout with no payment", fields: { latest_invoice: { id: "in_123", payments: { data: [] } } } },
  ])("refuses $name", async ({ fields }) => {
    retrieveSubscriptionMock.mockResolvedValue({ ...INCOMPLETE_SUBSCRIPTION, ...fields });

    await expect(recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: true, locale: DEFAULT_LOCALE }))
      .rejects.toBeInstanceOf(ActionError);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  test.each([
    { name: "a confirmed SetupIntent", fields: { status: "succeeded" } },
    { name: "a SetupIntent in processing", fields: { status: "processing" } },
    { name: "another customer's SetupIntent", fields: { customer: "cus_other" } },
    { name: "another team's SetupIntent", fields: { metadata: { teamId: "team-2" } } },
  ])("refuses $name", async ({ fields }) => {
    retrieveSetupIntentMock.mockResolvedValue({
      id: "seti_123",
      status: "requires_payment_method",
      customer: TEAM.stripeCustomerId,
      metadata: { teamId: TEAM.id },
      ...fields,
    });

    await expect(recordCheckoutConsent({
      teamId: TEAM.id,
      userId: "user-1",
      immediateStart: true,
      setupIntentId: "seti_123",
      locale: DEFAULT_LOCALE,
    })).rejects.toBeInstanceOf(ActionError);
    expect(updateSetupIntentMock).not.toHaveBeenCalled();
  });

  // A SEPA debit keeps the subscription incomplete for days after the confirm; the consent is final then.
  test.each(["processing", "succeeded", "canceled"])("refuses a checkout whose payment is %s", async (status) => {
    retrievePaymentIntentMock.mockResolvedValue({ id: "pi_123", status });

    await expect(recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: true, locale: DEFAULT_LOCALE }))
      .rejects.toBeInstanceOf(ActionError);
    expect(retrievePaymentIntentMock).toHaveBeenCalledWith("pi_123");
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  test.each(["requires_confirmation", "requires_action"])("accepts a checkout whose payment %s", async (status) => {
    retrievePaymentIntentMock.mockResolvedValue({ id: "pi_123", status });

    await recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: true, locale: DEFAULT_LOCALE });

    expect(updateSubscriptionMock).toHaveBeenCalledOnce();
  });

  test("refuses a team with no checkout", async () => {
    findTeamMock.mockResolvedValue({ ...TEAM, stripeSubscriptionId: null });

    await expect(recordCheckoutConsent({ teamId: TEAM.id, userId: "user-1", immediateStart: true, locale: DEFAULT_LOCALE }))
      .rejects.toBeInstanceOf(ActionError);
    expect(retrieveSubscriptionMock).not.toHaveBeenCalled();
  });
});
