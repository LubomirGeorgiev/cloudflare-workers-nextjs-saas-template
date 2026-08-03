import "server-only";

import { createSafeActionClient } from "next-safe-action";
import { getTranslations } from "next-intl/server";
import { ActionError, type ActionErrorMessageKey, type ActionErrorMessageParams } from "@/lib/action-error";
import { translateValidationKey } from "@/lib/validation-messages";
import { RateLimitError } from "@/utils/with-rate-limit";

export interface ActionServerError {
  code: string;
  message: string;
  // Stable catalog key of keyed ActionErrors, so clients can branch on the
  // error's identity instead of matching localized message text.
  reason?: ActionErrorMessageKey;
}

// next-intl can't type-check runtime-built keys; `ActionErrorMessageKey`
// already guarantees a valid catalog path at the throw site.
async function translateErrorKey(
  key: ActionErrorMessageKey,
  params?: ActionErrorMessageParams,
): Promise<string> {
  const t = await getTranslations();
  return (t as (key: string, params?: ActionErrorMessageParams) => string)(key, params);
}

const baseActionClient = createSafeActionClient({
  async handleServerError(error): Promise<ActionServerError> {
    if (error instanceof ActionError) {
      return {
        code: error.code,
        message: error.messageKey
          ? await translateErrorKey(error.messageKey, error.messageParams)
          : error.message,
        reason: error.messageKey,
      };
    }

    if (error instanceof RateLimitError) {
      const t = await getTranslations("Client.Errors");
      return {
        code: "RATE_LIMITED",
        message: t("rateLimitExceeded", {
          minutes: Math.ceil(error.retryAfterSeconds / 60),
        }),
      };
    }

    console.error("Safe action error:", error);
    const t = await getTranslations("Client.Errors");
    return {
      code: "INTERNAL_SERVER_ERROR",
      message: t("unexpected"),
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
  const tErrors = await getTranslations("Client.Errors");

  if (messages.length === 0) {
    return tErrors("invalidInput");
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
