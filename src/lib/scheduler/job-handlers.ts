import {
  SCHEDULED_JOB_TYPES,
  cmsPublishEntryJobPayloadSchema,
  creditExpireTransactionJobPayloadSchema,
  creditRefreshUserJobPayloadSchema,
  emailSendJobPayloadSchema,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import { publishScheduledCmsEntryIfDue } from "@/lib/cms/cms-scheduled-publishing";
import {
  processExpiredCreditTransactionIfDue,
} from "@/utils/credit-scheduler";
import { refreshScheduledUserCreditsIfDue } from "@/utils/credit-refresh-job";
import { renderTransactionalEmail, sendTransactionalEmailNow } from "@/utils/email";
import { v } from "@/lib/validation";

export async function runScheduledJob(message: ScheduledQueueMessage): Promise<void> {
  switch (message.type) {
    case SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY: {
      const payload = v.parse(cmsPublishEntryJobPayloadSchema, message.payload);

      await publishScheduledCmsEntryIfDue({
        entryId: payload.entryId,
      });
      return;
    }
    case SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION: {
      const payload = v.parse(creditExpireTransactionJobPayloadSchema, message.payload);

      await processExpiredCreditTransactionIfDue({
        transactionId: payload.transactionId,
      });
      return;
    }
    case SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER: {
      const payload = v.parse(creditRefreshUserJobPayloadSchema, message.payload);

      await refreshScheduledUserCreditsIfDue({
        userId: payload.userId,
      });
      return;
    }
    case SCHEDULED_JOB_TYPES.EMAIL_SEND: {
      const payload = v.parse(emailSendJobPayloadSchema, message.payload);

      await sendTransactionalEmailNow(renderTransactionalEmail(payload));
      return;
    }
  }

  throw new Error("Unknown scheduled job type");
}
