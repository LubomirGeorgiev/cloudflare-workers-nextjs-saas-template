import { maxString, trimmedString, v } from "@/lib/validation";
import { BAN_REASON_MAX_LENGTH, NAME_MAX_LENGTH } from "@/constants";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

export const SCHEDULED_JOB_TYPES = {
  BILLING_CANCEL_SUBSCRIPTION: "billing.cancel-subscription",
  CMS_PUBLISH_ENTRY: "cms.publish-entry",
  EMAIL_SEND: "email.send",
  TEAM_SESSIONS_REFRESH: "team.sessions-refresh",
} as const;

export type ScheduledJobType = typeof SCHEDULED_JOB_TYPES[keyof typeof SCHEDULED_JOB_TYPES];
export type SchedulerQueue = Cloudflare.Env["SCHEDULER_QUEUE"];

export const EMAIL_TEMPLATE_TYPES = {
  EMAIL_VERIFICATION: "email-verification",
  PASSWORD_RESET: "password-reset",
  TEAM_INVITATION: "team-invitation",
  BAN_NOTICE: "ban-notice",
  UNBAN_NOTICE: "unban-notice",
} as const;

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

// Small primitive, safe to carry on the queue payload — the consumer has no
// request context, so it can't resolve locale itself (see renderTransactionalEmail).
const emailLocaleSchema = v.optional(v.picklist(LOCALES), DEFAULT_LOCALE);

export const cmsPublishEntryJobPayloadSchema = v.object({
  entryId: nonEmptyString,
});
type CmsPublishEntryJobPayload = v.InferOutput<typeof cmsPublishEntryJobPayloadSchema>;

export const teamSessionsRefreshJobPayloadSchema = v.object({
  teamId: nonEmptyString,
});
type TeamSessionsRefreshJobPayload = v.InferOutput<typeof teamSessionsRefreshJobPayloadSchema>;

// Retry for a Stripe cancel that failed inline, so a ban is never blocked by a network call.
// Ids only, per the queue payload rule: the handler loads whatever else it needs.
export const billingCancelSubscriptionJobPayloadSchema = v.object({
  teamId: nonEmptyString,
  subscriptionId: nonEmptyString,
});
type BillingCancelSubscriptionJobPayload =
  v.InferOutput<typeof billingCancelSubscriptionJobPayloadSchema>;

const passwordResetEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.PASSWORD_RESET),
  locale: emailLocaleSchema,
  data: v.object({
    resetToken: nonEmptyString,
    username: nonEmptyString,
  }),
});

const emailVerificationJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION),
  locale: emailLocaleSchema,
  data: v.object({
    verificationToken: nonEmptyString,
    username: nonEmptyString,
  }),
});

const teamInvitationEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.TEAM_INVITATION),
  locale: emailLocaleSchema,
  data: v.object({
    invitationToken: nonEmptyString,
    inviterName: nonEmptyString,
    teamName: nonEmptyString,
  }),
});

// The two staff-initiated notices. Neither carries a `locale`: both are fixed English (see the
// justification beside their templates in `src/utils/email.tsx`).
//
// Neither carries the staff-only internal reason either, and that is the whole guarantee: it is
// not filtered out on the way here, it has nowhere to go. Grep `internalReason` — nothing under
// `src/utils/email.tsx` or this union mentions it.
const banNoticeEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.BAN_NOTICE),
  data: v.object({
    username: trimmedString({ min: 1, max: NAME_MAX_LENGTH }),
    // The staff-written message to the user. Absent = the notice carries no reason block.
    externalReason: v.optional(maxString(BAN_REASON_MAX_LENGTH)),
    // Whether any team subscription was cancelled, so the notice can say so.
    subscriptionCancelled: v.optional(v.boolean(), false),
  }),
});

const unbanNoticeEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.UNBAN_NOTICE),
  data: v.object({
    username: trimmedString({ min: 1, max: NAME_MAX_LENGTH }),
    externalReason: v.optional(maxString(BAN_REASON_MAX_LENGTH)),
    // Drives the one conditional line. Read from the latest `ban` event's stored count before
    // the unban writes anything.
    cancelledSubscriptionCount: v.optional(v.number(), 0),
  }),
});

export const emailSendJobPayloadSchema = v.union([
  passwordResetEmailJobPayloadSchema,
  emailVerificationJobPayloadSchema,
  teamInvitationEmailJobPayloadSchema,
  banNoticeEmailJobPayloadSchema,
  unbanNoticeEmailJobPayloadSchema,
]);

export type EmailSendJobPayload = v.InferOutput<typeof emailSendJobPayloadSchema>;

interface ScheduledJobPayloadByType {
  [SCHEDULED_JOB_TYPES.BILLING_CANCEL_SUBSCRIPTION]: BillingCancelSubscriptionJobPayload;
  [SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY]: CmsPublishEntryJobPayload;
  [SCHEDULED_JOB_TYPES.EMAIL_SEND]: EmailSendJobPayload;
  [SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH]: TeamSessionsRefreshJobPayload;
}

export type ScheduledJobPayload<T extends ScheduledJobType = ScheduledJobType> =
  ScheduledJobPayloadByType[T];

type ScheduledQueueMessageFor<T extends ScheduledJobType> = {
  type: T;
  payload: ScheduledJobPayload<T>;
  runAt: string;
};

export type ScheduledQueueMessage = {
  [Type in ScheduledJobType]: ScheduledQueueMessageFor<Type>;
}[ScheduledJobType];

export function createScheduledQueueMessage<T extends ScheduledJobType>({
  payload,
  runAt,
  type,
}: {
  payload: ScheduledJobPayload<T>;
  runAt: Date;
  type: T;
}): ScheduledQueueMessageFor<T> {
  return {
    type,
    payload,
    runAt: runAt.toISOString(),
  };
}
