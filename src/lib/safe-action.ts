import "server-only";

import { createSafeActionClient } from "next-safe-action";
import { ActionError } from "@/lib/action-error";

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (error instanceof ActionError) {
      return {
        code: error.code,
        message: error.message,
      };
    }

    console.error("Safe action error:", error);
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong",
    };
  },
});
