import "server-only";

import { createSafeActionClient } from "next-safe-action";
import { getTranslations } from "next-intl/server";
import { ActionError } from "@/lib/action-error";
import { translateValidationKey } from "@/lib/validation-messages";
import { RateLimitError } from "@/utils/with-rate-limit";

const baseActionClient = createSafeActionClient({
  handleServerError(error) {
    if (error instanceof ActionError) {
      return {
        code: error.code,
        message: error.message,
      };
    }

    if (error instanceof RateLimitError) {
      return {
        code: "RATE_LIMITED",
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

export const actionClient = baseActionClient.use(async ({ next }) => {
  const result = await next();

  if (typeof result.validationErrors !== "undefined") {
    result.serverError = {
      code: "INPUT_PARSE_ERROR",
      message: await getValidationErrorMessage(result.validationErrors),
    };
    result.validationErrors = undefined;
  }

  return result;
});

async function getValidationErrorMessage(validationErrors: unknown): Promise<string> {
  const messages = collectValidationMessages(validationErrors);

  if (messages.length === 0) {
    return "Invalid input";
  }

  // Valibot messages set via src/lib/validation.ts are stable `Validation.*` keys;
  // translate them here since this runs server-side before the message reaches the
  // client toast. Non-keyed (custom inline) schema messages pass through unchanged.
  const t = await getTranslations("Client.Validation");
  return messages.map((message) => translateValidationKey(t, message)).join(" ");
}

function collectValidationMessages(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectValidationMessages);
  }

  const record = value as Record<string, unknown>;
  const ownErrors = Array.isArray(record._errors)
    ? record._errors.filter((message): message is string => typeof message === "string")
    : [];

  return [
    ...ownErrors,
    ...Object.entries(record)
      .filter(([key]) => key !== "_errors")
      .flatMap(([, child]) => collectValidationMessages(child)),
  ];
}
