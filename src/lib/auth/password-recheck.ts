import "server-only";

import { ActionError } from "@/lib/action-error";
import type { SessionRecheckState } from "@/utils/session-user";

export function invalidCredentialsError(): ActionError {
  return new ActionError("NOT_AUTHORIZED", {
    key: "Client.Auth.SignIn.errorInvalidCredentials",
  });
}

// A password reset or a Google reclaim can change the hash after the caller proved the password.
// Pass this as the `createSessionUnlessBanned` recheck, so a changed hash rolls that session back.
export function assertPasswordHashUnchanged({
  state,
  verifiedHash,
}: {
  state: SessionRecheckState | null;
  verifiedHash: string;
}): void {
  if (state?.passwordHash !== verifiedHash) {
    throw invalidCredentialsError();
  }
}
