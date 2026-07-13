import { v } from "@/lib/validation";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

export const SCHEDULED_JOB_TYPES = {
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

export const emailSendJobPayloadSchema = v.union([
  passwordResetEmailJobPayloadSchema,
  emailVerificationJobPayloadSchema,
  teamInvitationEmailJobPayloadSchema,
]);

export type EmailSendJobPayload = v.InferOutput<typeof emailSendJobPayloadSchema>;

interface ScheduledJobPayloadByType {
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
