import * as v from "valibot";

import { EMAIL_MAX_LENGTH } from "@/constants";
import { encodeValidationMessage, validationKey } from "@/lib/validation-messages";

// Assert a visible character rather than banning invisible ones: ZWJ holds emoji sequences
// together and ZWNJ is orthographically required in Persian and Hindi, so a denylist would
// reject or corrupt legitimate names.
const VISIBLE_CHARACTER = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

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
const INVALID_OBJECT_MESSAGE = validationKey("invalidObject");

function humanTypeMessage({
  received,
  invalidMessage,
  requiredMessage = REQUIRED_FIELD_MESSAGE,
}: {
  received: string;
  invalidMessage: string;
  requiredMessage?: string;
}) {
  return received === "undefined" ? requiredMessage : invalidMessage;
}

// A key missing from the input is reported by the *object* schema, not by the entry's own schema,
// so without this an API client gets Valibot's raw English `Invalid key: Expected "x" ...` where
// every other rejected field carries a stable `Validation.*` key.
v.setSpecificMessage(v.object, (issue) =>
  humanTypeMessage({ received: issue.received, invalidMessage: INVALID_OBJECT_MESSAGE })
);
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

// `v.string(requiredMessage)` would answer a wrong-typed value with the caller's "required" copy —
// misleading in a form, and an unstable code for an API client. Only an absent value gets it.
function stringType(requiredMessage: string) {
  return v.string((issue) =>
    humanTypeMessage({
      received: issue.received,
      invalidMessage: INVALID_STRING_MESSAGE,
      requiredMessage,
    })
  );
}

export function requiredString(message?: string) {
  const requiredMessage = message ?? REQUIRED_FIELD_MESSAGE;
  return v.pipe(stringType(requiredMessage), v.minLength(1, requiredMessage));
}

// The length check sits ahead of the format check on purpose: the email pattern should never be
// run against an unbounded string.
export function emailString(message?: string) {
  return v.config(
    v.pipe(
      requiredString(),
      v.maxLength(
        EMAIL_MAX_LENGTH,
        encodeValidationMessage("emailMaxLength", { max: EMAIL_MAX_LENGTH })
      ),
      v.email(message ?? INVALID_EMAIL_MESSAGE)
    ),
    { abortPipeEarly: true }
  );
}

// Canonical email form used at every identity boundary (auth lookups, rate-limit keys, team
// invitations). SQLite's unique index is case-sensitive, so differently cased spellings would
// otherwise become distinct identities. `emailString()` validates but intentionally does not
// normalize, so callers must canonicalize before comparing or storing.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function minString(length: number, message?: string) {
  return v.pipe(
    stringType(REQUIRED_FIELD_MESSAGE),
    v.minLength(length, message ?? encodeValidationMessage("minLength", { min: length }))
  );
}

export function maxString(length: number, message?: string) {
  return v.pipe(
    stringType(REQUIRED_FIELD_MESSAGE),
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
      stringType(minMessage ?? REQUIRED_FIELD_MESSAGE),
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

  return stringType(REQUIRED_FIELD_MESSAGE);
}

/**
 * Trim before the length checks, for labels a user types. Composing `minMaxString()` with a later
 * trim would let a whitespace-only value through as "", so the order is the point of the helper.
 */
export function trimmedString({
  min,
  max,
  minMessage,
  maxMessage,
}: {
  min: number;
  max: number;
  minMessage?: string;
  maxMessage?: string;
}) {
  return v.pipe(
    stringType(minMessage ?? REQUIRED_FIELD_MESSAGE),
    v.trim(),
    v.minLength(min, minMessage ?? encodeValidationMessage("minLength", { min })),
    v.maxLength(max, maxMessage ?? encodeValidationMessage("maxLength", { max })),
    // Last in the pipe so an oversized invisible payload still trips `maxLength` first.
    v.check((value) => VISIBLE_CHARACTER.test(value), minMessage ?? REQUIRED_FIELD_MESSAGE)
  );
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
