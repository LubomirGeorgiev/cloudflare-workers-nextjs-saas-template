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
};
