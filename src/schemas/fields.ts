import {
  DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  ID_MAX_LENGTH,
  MAX_ADMIN_TABLE_PAGE_SIZE,
  SLUG_MAX_LENGTH,
  TOKEN_MAX_LENGTH,
} from "@/constants";
import { minMaxString, v, validationKey } from "@/lib/validation";

// Field rules shared by more than one schema. A rule stated once here cannot drift between the
// dashboard form, the server action, and the public API that all validate the same value.
//
// Every rule is bounded. A string field with no ceiling lets any caller decide how much CPU, D1
// row, and KV value budget a single request spends, so identifiers and tokens take the shared
// caps below rather than being left open.

/** Opaque identifiers: our generated ids, Stripe ids, credential ids, grant ids. */
export function idField(message?: string) {
  return minMaxString({ min: 1, max: ID_MAX_LENGTH, minMessage: message });
}

/** Single-use opaque secrets: email verification, password reset, invitation tokens. */
export function tokenField(message?: string) {
  return minMaxString({ min: 1, max: TOKEN_MAX_LENGTH, minMessage: message });
}

/** URL-addressable slugs, which end up in a route segment and a D1 index. */
export function slugField(message?: string) {
  return minMaxString({ min: 1, max: SLUG_MAX_LENGTH, minMessage: message });
}

/** Path or body `teamId`. Not a `v.object`: callers compose it with their own fields. */
export function teamIdField() {
  return idField(validationKey("teamIdRequired"));
}

export function sessionIdField() {
  return idField(validationKey("sessionIdRequired"));
}

/** The `/teams/:teamId` path parameter, which most API routes validate. */
export const teamIdParamSchema = v.object({
  teamId: teamIdField(),
});

/**
 * The page/pageSize pair every admin listing schema takes. Spread it into the object; the bounds
 * are the DataTable's own page-size options, so a hand-edited request cannot ask D1 for more rows
 * than the UI can ever show.
 */
export const adminTablePaginationFields = {
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  pageSize: v.optional(
    v.pipe(v.number(), v.minValue(1), v.maxValue(MAX_ADMIN_TABLE_PAGE_SIZE)),
    DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  ),
};
