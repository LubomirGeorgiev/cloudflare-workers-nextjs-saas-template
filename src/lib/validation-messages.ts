// Wire format: `Validation.<key>` + optional JSON params, e.g.
// `Validation.minLength {"min":6}`. Non-prefixed messages pass through unchanged.

// Single source of truth for the prefix — never hard-code the `Validation.` literal.
const VALIDATION_KEY_PREFIX = "Validation.";

// Bare `Validation.<key>` message (encode side of `translateValidationKey`).
export function validationKey(key: string) {
  return `${VALIDATION_KEY_PREFIX}${key}`;
}

// Like `validationKey` but appends runtime params as JSON: `Validation.minLength {"min":6}`.
export function encodeValidationMessage(key: string, params: Record<string, unknown>) {
  return `${validationKey(key)} ${JSON.stringify(params)}`;
}

// next-intl can't type-check runtime-built keys decoded from Valibot messages.
// Callers still pass real `useTranslations`/`getTranslations` translators.
// oxlint-disable-next-line typescript/no-explicit-any -- bridges next-intl's strongly-keyed translator to a runtime-built key.
type AnyValidationTranslator = (...args: any[]) => string;

export function translateValidationKey(
  t: AnyValidationTranslator,
  rawMessage: string | undefined
): string | undefined {
  if (!rawMessage || !rawMessage.startsWith(VALIDATION_KEY_PREFIX)) {
    return rawMessage;
  }

  const withoutPrefix = rawMessage.slice(VALIDATION_KEY_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(" ");

  if (separatorIndex === -1) {
    return t(withoutPrefix, undefined);
  }

  const key = withoutPrefix.slice(0, separatorIndex);
  const rawParams = withoutPrefix.slice(separatorIndex + 1);

  let params: Record<string, unknown> | undefined;
  try {
    params = JSON.parse(rawParams);
  } catch {
    // Malformed params: fall back to translating with no params rather than throwing.
    params = undefined;
  }

  return t(key, params);
}
