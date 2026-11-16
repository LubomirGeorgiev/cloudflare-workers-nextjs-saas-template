// Fixture data per template for `scripts/preview-emails.mjs`, keyed by the `EMAIL_TEMPLATE_TYPES`
// keys. Deliberately awkward strings: an accented name and an ampersand prove the escaping still
// holds in the rendered page, which a preview of clean data would hide.
const TEAM_OWNER_NOTICE = { username: "Ana Müller", teamName: "Acme & Co", teamSlug: "acme-co" };

export const PREVIEW_DATA = {
  PASSWORD_RESET: { resetToken: "preview-reset-token", username: "Ana Müller" },
  EMAIL_VERIFICATION: { verificationToken: "preview-verification-token", username: "Ana Müller" },
  TEAM_INVITATION: {
    invitationToken: "preview-invitation-token",
    inviterName: "Ana Müller",
    teamName: "Acme & Co",
  },
  BAN_NOTICE: {
    username: "Ana Müller",
    externalReason: "Repeated chargebacks & disputes on this account.",
    subscriptionCancelled: true,
  },
  UNBAN_NOTICE: {
    username: "Ana Müller",
    externalReason: "Our review found no fraud & your access is back.",
    cancelledSubscriptionCount: 2,
  },
  PAYMENT_PAST_DUE: TEAM_OWNER_NOTICE,
  PAYMENT_UNPAID: TEAM_OWNER_NOTICE,
  ORDER_CONFIRMATION: {
    ...TEAM_OWNER_NOTICE,
    planName: "Pro",
    startedAt: "2026-03-01T09:30:00.000Z",
    withdrawal: {
      windowEndsAt: "2026-03-16T01:00:00.000Z",
      consent: {
        at: "2026-03-01T09:29:00.000Z",
        text: "Start my subscription now. I understand that if I withdraw within 14 days, I pay for the days I have used.",
      },
    },
  },
  WITHDRAWAL_RECEIPT: {
    name: "Ana Müller",
    teamName: "Acme & Co",
    planName: "Pro",
    startedAt: "2026-03-01T09:30:00.000Z",
    withdrawnAt: "2026-03-04T15:45:00.000Z",
    refund: { kind: "prorated", amount: 2580, currency: "eur" },
  },
};
