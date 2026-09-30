import "server-only";

import { createSafeActionClient } from "next-safe-action";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "@/i18n/server";
import { ActionError, type ActionErrorMessageKey, type ActionErrorMessageParams } from "@/lib/action-error";
import { translateValidationKey } from "@/lib/validation-messages";
import { actionMetadataSchema } from "@/schemas/action-metadata.schema";
import { recordSpanException, withSpan } from "@/utils/trace";
import { RateLimitError } from "@/utils/with-rate-limit";

const ACTION_SPAN_NAME = "app.action";
const ACTION_NAME_ATTRIBUTE = "app.action.name";
const ACTION_OUTCOME_ATTRIBUTE = "app.action.outcome";
const ACTION_NAVIGATION_KIND_ATTRIBUTE = "app.action.navigation_kind";
const REDIRECT_NAVIGATION_KIND = "redirect";
const REDIRECT_DIGEST_PREFIX = "NEXT_REDIRECT;";

const ACTION_OUTCOME = {
  OK: "ok",
  VALIDATION_ERROR: "validation_error",
  RATE_LIMITED: "rate_limited",
  INTERNAL_ERROR: "internal_error",
  NAVIGATION: "navigation",
} as const;

const RATE_LIMITED_ERROR_CODE = "RATE_LIMITED";
const INTERNAL_SERVER_ERROR_CODE = "INTERNAL_SERVER_ERROR";

// `handleServerError` runs inside `next()`, where the action span is out of reach. It marks its
// unexpected-error results here, so the middleware can tell them apart from an ActionError.
const unexpectedServerErrors = new WeakMap<ActionServerError, Error>();

export interface ActionServerError {
  code: string;
  message: string;
  // Stable catalog key of keyed ActionErrors, so clients can branch on the
  // error's identity instead of matching localized message text.
  reason?: ActionErrorMessageKey;
}

// A translator can't type-check runtime-built keys; `ActionErrorMessageKey`
// already guarantees a valid catalog path at the throw site.
async function translateErrorKey(
  key: ActionErrorMessageKey,
  params?: ActionErrorMessageParams,
): Promise<string> {
  const t = await getTranslations();
  return (t as (key: string, params?: ActionErrorMessageParams) => string)(key, params);
}

const baseActionClient = createSafeActionClient({
  // With a schema, next-safe-action refuses `.action()` until `.metadata()` names the action.
  defineMetadataSchema: () => actionMetadataSchema,
  async handleServerError(error): Promise<ActionServerError> {
    // vinext's redirect digest has no type or status, so next-safe-action misses it as a navigation.
    unstable_rethrow(error);

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
        code: RATE_LIMITED_ERROR_CODE,
        message: t("rateLimitExceeded", {
          minutes: Math.ceil(error.retryAfterSeconds / 60),
        }),
      };
    }

    console.error("Safe action error:", error);
    const t = await getTranslations("Client.Errors");
    const serverError: ActionServerError = {
      code: INTERNAL_SERVER_ERROR_CODE,
      message: t("unexpected"),
    };
    unexpectedServerErrors.set(serverError, error);

    return serverError;
  },
});

export const actionClient = baseActionClient.use(({ next, metadata }) =>
  withSpan({
    name: ACTION_SPAN_NAME,
    isExpected: isRedirectSignal,
    run: async (span) => {
      span.setAttribute(ACTION_NAME_ATTRIBUTE, metadata.actionName);

      let result: Awaited<ReturnType<typeof next>>;

      try {
        result = await next();
      } catch (error) {
        if (isRedirectSignal(error)) {
          span.setAttribute(ACTION_OUTCOME_ATTRIBUTE, ACTION_OUTCOME.NAVIGATION);
          span.setAttribute(ACTION_NAVIGATION_KIND_ATTRIBUTE, REDIRECT_NAVIGATION_KIND);
        }

        throw error;
      }

      span.setAttribute(ACTION_OUTCOME_ATTRIBUTE, getActionOutcome(result));

      if (result.navigationKind) {
        span.setAttribute(ACTION_NAVIGATION_KIND_ATTRIBUTE, result.navigationKind);
      }

      const unexpectedError = result.serverError
        ? unexpectedServerErrors.get(result.serverError)
        : undefined;

      if (unexpectedError) {
        recordSpanException({ span, error: unexpectedError });
      } else if (result.serverError) {
        // Refusals (wrong password, bad token, rate limit) are answers, not faults: no span exception,
        // and `warn` so they do not trip error alerts. The span has the code but not the reason.
        console.warn("Action refused", {
          action: metadata.actionName,
          code: result.serverError.code,
          // A plain-string `ActionError` has no key; its message is developer text, safe to log.
          reason: result.serverError.reason ?? result.serverError.message,
        });
      }

      if (typeof result.validationErrors !== "undefined") {
        result.serverError = {
          code: "INPUT_PARSE_ERROR",
          message: await getValidationErrorMessage(result.validationErrors),
        };
        result.validationErrors = undefined;
      }

      return result;
    },
  }),
);

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

// Same precedence as next-safe-action's result: a navigation wins, then validation, then a server error.
function getActionOutcome(result: {
  navigationKind?: string;
  validationErrors?: unknown;
  serverError?: ActionServerError;
}): string {
  if (result.navigationKind) {
    return ACTION_OUTCOME.NAVIGATION;
  }

  if (typeof result.validationErrors !== "undefined") {
    return ACTION_OUTCOME.VALIDATION_ERROR;
  }

  if (!result.serverError) {
    return ACTION_OUTCOME.OK;
  }

  if (unexpectedServerErrors.has(result.serverError)) {
    return ACTION_OUTCOME.INTERNAL_ERROR;
  }

  if (result.serverError.code === RATE_LIMITED_ERROR_CODE) {
    return ACTION_OUTCOME.RATE_LIMITED;
  }

  return result.serverError.code;
}

// A copy of `isRedirectError` in vinext's `next/navigation` shim, which the `next` types do not
// export. It matches both vinext's digest and the Next.js form; `handleServerError` rethrows these.
function isRedirectSignal(error: unknown): error is Error & { digest: string } {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith(REDIRECT_DIGEST_PREFIX)
  );
}
