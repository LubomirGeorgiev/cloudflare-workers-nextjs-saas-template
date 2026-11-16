// The EU consumer right of withdrawal (Directive 2011/83/EU, art. 9 to 16). The master switch is
// `EU_WITHDRAWAL_ENABLED` in `src/constants.ts`.

export const WITHDRAWAL_PERIOD_DAYS = 14;
// The widest offset from UTC of an EU time zone, outermost regions included (UTC-4 to UTC+4).
// The window ends at the close of the day in every one of them, so it never closes early.
export const WITHDRAWAL_ZONE_OFFSET_MS = 4 * 60 * 60 * 1000;
// The extra hour absorbs clock skew between us and Stripe.
export const WITHDRAWAL_WINDOW_GRACE_MS = 60 * 60 * 1000;
// Art. 13: we refund within 14 days of the day the withdrawal reached us.
export const REFUND_DEADLINE_DAYS = 14;
// Bump when `immediateStartConsent` changes in meaning, so a stored consent names the text it saw.
export const CONSENT_TEXT_VERSION = 1;
// The longest consent text one catalog may hold. Stripe caps a metadata value at 500 characters.
export const CONSENT_TEXT_MAX_LENGTH = 500;

// Where the right of withdrawal applies, as ISO 3166-1 alpha-2 codes (Stripe's form; Greece is GR).
// The EEA Agreement extends Directive 2011/83/EU to Iceland, Liechtenstein, and Norway.
export const EU_EEA_COUNTRY_CODES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  "IS", "LI", "NO",
] as const;

// Stripe metadata is the record of the order and the withdrawal; there is no D1 table.
export const SUBSCRIPTION_WITHDRAWAL_METADATA = {
  orderUserId: "eu_order_user_id",
  consentAt: "eu_consent_at",
  consentVersion: "eu_consent_version",
  consentLocale: "eu_consent_locale",
  consentText: "eu_consent_text",
  withdrawnAt: "eu_withdrawn_at",
  withdrawnByUserId: "eu_withdrawn_by_user_id",
  receiptSentAt: "eu_receipt_sent_at",
  // The run time of the one resume job that may continue; a job with another run time stops.
  resumeAt: "eu_resume_at",
  needsStaffAt: "eu_withdrawal_needs_staff_at",
} as const;

// What the withdrawal receipt says about the refund: all of it, the unused days, or nothing paid.
export const WITHDRAWAL_REFUND_KINDS = ["full", "prorated", "none"] as const;
export type WithdrawalRefundKind = (typeof WITHDRAWAL_REFUND_KINDS)[number];

export const CREDIT_NOTE_WITHDRAWAL_METADATA = {
  subscriptionId: "eu_withdrawal_subscription_id",
} as const;
