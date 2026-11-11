/** The id of an expandable Stripe field, which holds either the id or the expanded object. */
export function getStripeId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}
