import "server-only";

import { ActionError } from "@/lib/action-error";
import { requireVerifiedEmail } from "@/utils/auth";

interface RunVerifiedActionParams<T> {
  actionName: string;
  failureMessage: string;
  handler: () => Promise<T>;
}

type VerifiedActionResult<T> = T extends void
  ? { success: true }
  : { success: true; data: T };

export async function runVerifiedAction<T>({
  actionName,
  failureMessage,
  handler,
}: RunVerifiedActionParams<T>): Promise<VerifiedActionResult<T>> {
  const session = await requireVerifiedEmail();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", "Not authenticated");
  }

  try {
    const data = await handler();

    if (data === undefined) {
      return { success: true } as VerifiedActionResult<T>;
    }

    return { success: true, data } as VerifiedActionResult<T>;
  } catch (error) {
    console.error(`${actionName}:`, error);

    if (error instanceof ActionError) {
      throw error;
    }

    throw new ActionError("INTERNAL_SERVER_ERROR", failureMessage);
  }
}
