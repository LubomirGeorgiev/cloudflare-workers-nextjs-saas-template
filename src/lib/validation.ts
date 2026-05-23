import * as v from "valibot";

export { v };

export function requiredString(message?: string) {
  return v.pipe(v.string(), v.minLength(1, message));
}

export function emailString(message?: string) {
  return v.pipe(v.string(), v.email(message));
}

export function minString(length: number, message?: string) {
  return v.pipe(v.string(), v.minLength(length, message));
}

export function maxString(length: number, message?: string) {
  return v.pipe(v.string(), v.maxLength(length, message));
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
    return v.pipe(v.string(), v.minLength(min, minMessage), v.maxLength(max, maxMessage));
  }

  if (typeof min === "number") {
    return v.pipe(v.string(), v.minLength(min, minMessage));
  }

  if (typeof max === "number") {
    return v.pipe(v.string(), v.maxLength(max, maxMessage));
  }

  return v.string();
}

export function coerceNumber() {
  return v.pipe(v.unknown(), v.transform(Number), v.number());
}

export function coerceDate() {
  return v.pipe(
    v.unknown(),
    v.transform((input) => new Date(input as string | number | Date)),
    v.date()
  );
}
