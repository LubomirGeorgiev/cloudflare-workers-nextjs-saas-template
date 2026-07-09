import * as v from "valibot";

import { encodeValidationMessage, validationKey } from "@/lib/validation-messages";

export { v };
// Re-exported so schemas import validation from one module; wire format lives in `validation-messages.ts`.
export { encodeValidationMessage, validationKey };

// Stable `Validation.*` i18n keys (not English copy); `translateValidationKey` localizes them
// via `FormMessage`. Built with `validationKey` so the prefix lives in one place; keys needing
// a runtime value encode it as `Validation.minLength {"min":6}`.
const REQUIRED_FIELD_MESSAGE = validationKey("required");
const INVALID_STRING_MESSAGE = validationKey("invalidString");
const INVALID_NUMBER_MESSAGE = validationKey("invalidNumber");
const INVALID_BOOLEAN_MESSAGE = validationKey("invalidBoolean");
const INVALID_DATE_MESSAGE = validationKey("invalidDate");
const INVALID_EMAIL_MESSAGE = validationKey("invalidEmail");

function humanTypeMessage({
  received,
  invalidMessage,
}: {
  received: string;
  invalidMessage: string;
}) {
  return received === "undefined" ? REQUIRED_FIELD_MESSAGE : invalidMessage;
}

v.setSpecificMessage(v.string, (issue) =>
  humanTypeMessage({ received: issue.received, invalidMessage: INVALID_STRING_MESSAGE })
);
v.setSpecificMessage(v.number, (issue) =>
  humanTypeMessage({ received: issue.received, invalidMessage: INVALID_NUMBER_MESSAGE })
);
v.setSpecificMessage(v.boolean, (issue) =>
  humanTypeMessage({ received: issue.received, invalidMessage: INVALID_BOOLEAN_MESSAGE })
);
v.setSpecificMessage(v.date, (issue) =>
  humanTypeMessage({ received: issue.received, invalidMessage: INVALID_DATE_MESSAGE })
);

export function requiredString(message?: string) {
  const requiredMessage = message ?? REQUIRED_FIELD_MESSAGE;
  return v.pipe(v.string(requiredMessage), v.minLength(1, requiredMessage));
}

export function emailString(message?: string) {
  return v.config(
    v.pipe(
      requiredString(),
      v.email(message ?? INVALID_EMAIL_MESSAGE)
    ),
    { abortPipeEarly: true }
  );
}

export function minString(length: number, message?: string) {
  return v.pipe(
    v.string(REQUIRED_FIELD_MESSAGE),
    v.minLength(length, message ?? encodeValidationMessage("minLength", { min: length }))
  );
}

export function maxString(length: number, message?: string) {
  return v.pipe(
    v.string(REQUIRED_FIELD_MESSAGE),
    v.maxLength(length, message ?? encodeValidationMessage("maxLength", { max: length }))
  );
}

export function minMaxString({
  min,
  max,
  minMessage,
  maxMessage,
}: {
  min?: number;
  max?: number;
  minMessage?: string;
  maxMessage?: string;
}) {
  if (typeof min === "number" && typeof max === "number") {
    return v.pipe(
      v.string(REQUIRED_FIELD_MESSAGE),
      v.minLength(min, minMessage ?? encodeValidationMessage("minLength", { min })),
      v.maxLength(max, maxMessage ?? encodeValidationMessage("maxLength", { max }))
    );
  }

  if (typeof min === "number") {
    return minString(min, minMessage);
  }

  if (typeof max === "number") {
    return maxString(max, maxMessage);
  }

  return v.string(REQUIRED_FIELD_MESSAGE);
}

export function coerceNumber() {
  return v.pipe(v.unknown(), v.transform(Number), v.number(INVALID_NUMBER_MESSAGE));
}

export function coerceDate() {
  return v.pipe(
    v.unknown(),
    v.transform((input) => new Date(input as string | number | Date)),
    v.date(INVALID_DATE_MESSAGE)
  );
}
