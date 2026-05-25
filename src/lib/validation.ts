import * as v from "valibot";

export { v };

const REQUIRED_FIELD_MESSAGE = "This field is required";
const INVALID_STRING_MESSAGE = "Please enter text";
const INVALID_NUMBER_MESSAGE = "Please enter a number";
const INVALID_BOOLEAN_MESSAGE = "Please choose an option";
const INVALID_DATE_MESSAGE = "Please enter a valid date";
const INVALID_EMAIL_MESSAGE = "Please enter a valid email address";

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
    v.minLength(length, message ?? `Must be at least ${length} characters`)
  );
}

export function maxString(length: number, message?: string) {
  return v.pipe(
    v.string(REQUIRED_FIELD_MESSAGE),
    v.maxLength(length, message ?? `Must be ${length} characters or less`)
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
      v.minLength(min, minMessage ?? `Must be at least ${min} characters`),
      v.maxLength(max, maxMessage ?? `Must be ${max} characters or less`)
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
