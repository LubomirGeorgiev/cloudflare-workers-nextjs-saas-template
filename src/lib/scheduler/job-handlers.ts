import {
  SCHEDULED_JOB_TYPES,
  cmsPublishEntryJobPayloadSchema,
  emailSendJobPayloadSchema,
  teamSessionsRefreshJobPayloadSchema,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import { publishScheduledCmsEntryIfDue } from "@/lib/cms/cms-scheduled-publishing";
import { renderTransactionalEmail, sendTransactionalEmailNow } from "@/utils/email";
import { refreshTeamMemberSessions } from "@/utils/kv-session";
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
