import {
  SCHEDULED_JOB_TYPES,
  billingCancelSubscriptionJobPayloadSchema,
  cmsPublishEntryJobPayloadSchema,
  emailSendJobPayloadSchema,
  teamSessionsRefreshJobPayloadSchema,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import { cancelTeamSubscriptionAsAdmin } from "@/lib/admin/team-billing-admin";
import { publishScheduledCmsEntryIfDue } from "@/lib/cms/cms-scheduled-publishing";
import { renderTransactionalEmail, sendTransactionalEmailNow } from "@/utils/email";
import { refreshTeamMemberSessions } from "@/utils/kv-session";
import { v } from "@/lib/validation";

// The queue payload carries ids only, so the staff reason cannot travel with it. Stripe records
// this instead, and the ban event itself holds the reason a person wrote.
const BAN_CANCEL_RETRY_REASON = "Cancelled by staff (retry of a cancellation that failed inline)";

export async function runScheduledJob(message: ScheduledQueueMessage): Promise<void> {
  switch (message.type) {
    case SCHEDULED_JOB_TYPES.BILLING_CANCEL_SUBSCRIPTION: {
      const payload = v.parse(billingCancelSubscriptionJobPayloadSchema, message.payload);

      await cancelTeamSubscriptionAsAdmin({
        teamId: payload.teamId,
        subscriptionId: payload.subscriptionId,
        reason: BAN_CANCEL_RETRY_REASON,
      });
      return;
    }
    case SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY: {
      const payload = v.parse(cmsPublishEntryJobPayloadSchema, message.payload);

      await publishScheduledCmsEntryIfDue({
        entryId: payload.entryId,
      });
      return;
    }
    case SCHEDULED_JOB_TYPES.EMAIL_SEND: {
      const payload = v.parse(emailSendJobPayloadSchema, message.payload);

      await sendTransactionalEmailNow(await renderTransactionalEmail(payload));
      return;
    }
    case SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH: {
      const payload = v.parse(teamSessionsRefreshJobPayloadSchema, message.payload);

      await refreshTeamMemberSessions(payload.teamId);
      return;
    }
  }

  throw new Error("Unknown scheduled job type");
}
