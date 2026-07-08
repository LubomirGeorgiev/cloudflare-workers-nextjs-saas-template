/**
 * Wire format for Valibot display messages: `Validation.<key>` + optional JSON params,
 * e.g. `Validation.minLength {"min":6}`. Owns encode (`validationKey`/`encodeValidationMessage`)
 * and decode (`translateValidationKey`); non-prefixed messages pass through unchanged.
 */

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

// Matches next-intl's `useTranslations`/`getTranslations` translator shape but
// opts out of its strict key typing, which can't verify a runtime-built key
// derived from an encoded Valibot message. Callers still pass real translators.
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
