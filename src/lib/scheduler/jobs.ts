import { v } from "@/lib/validation";

export const SCHEDULED_JOB_TYPES = {
  CMS_PUBLISH_ENTRY: "cms.publish-entry",
  CREDIT_EXPIRE_TRANSACTION: "credits.expire-transaction",
  CREDIT_REFRESH_USER: "credits.refresh-user",
  EMAIL_SEND: "email.send",
} as const;

export type ScheduledJobType = typeof SCHEDULED_JOB_TYPES[keyof typeof SCHEDULED_JOB_TYPES];
export type SchedulerQueue = Cloudflare.Env["SCHEDULER_QUEUE"];

export const EMAIL_TEMPLATE_TYPES = {
  EMAIL_VERIFICATION: "email-verification",
  PASSWORD_RESET: "password-reset",
  TEAM_INVITATION: "team-invitation",
} as const;

const nonEmptyString = v.pipe(v.string(), v.minLength(1));

export const cmsPublishEntryJobPayloadSchema = v.object({
  entryId: nonEmptyString,
});
type CmsPublishEntryJobPayload = v.InferOutput<typeof cmsPublishEntryJobPayloadSchema>;

export const creditExpireTransactionJobPayloadSchema = v.object({
  transactionId: nonEmptyString,
});
type CreditExpireTransactionJobPayload = v.InferOutput<typeof creditExpireTransactionJobPayloadSchema>;

export const creditRefreshUserJobPayloadSchema = v.object({
  userId: nonEmptyString,
});
type CreditRefreshUserJobPayload = v.InferOutput<typeof creditRefreshUserJobPayloadSchema>;

const passwordResetEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.PASSWORD_RESET),
  data: v.object({
    resetToken: nonEmptyString,
    username: nonEmptyString,
  }),
});

const emailVerificationJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION),
  data: v.object({
    verificationToken: nonEmptyString,
    username: nonEmptyString,
  }),
});

const teamInvitationEmailJobPayloadSchema = v.object({
  to: nonEmptyString,
  template: v.literal(EMAIL_TEMPLATE_TYPES.TEAM_INVITATION),
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
  [SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION]: CreditExpireTransactionJobPayload;
  [SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER]: CreditRefreshUserJobPayload;
  [SCHEDULED_JOB_TYPES.EMAIL_SEND]: EmailSendJobPayload;
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
