import "server-only";

import { ActionError, type ActionErrorMessageKey } from "@/lib/action-error";
import { requireVerifiedEmail } from "@/utils/auth";

interface RunVerifiedActionParams<T> {
  actionName: string;
  failureMessageKey: ActionErrorMessageKey;
  handler: () => Promise<T>;
}

type VerifiedActionResult<T> = T extends void
  ? { success: true }
  : { success: true; data: T };

export async function runVerifiedAction<T>({
  actionName,
  failureMessageKey,
  handler,
}: RunVerifiedActionParams<T>): Promise<VerifiedActionResult<T>> {
  const session = await requireVerifiedEmail();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
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

    throw new ActionError("INTERNAL_SERVER_ERROR", { key: failureMessageKey });
  }
}
