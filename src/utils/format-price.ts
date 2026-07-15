import type { Locale } from "@/i18n/config";

// Formats a Stripe smallest-unit amount (e.g. cents) in the viewer's app locale. Shared
// by billing UI on both server and client; whole amounts drop the fraction digits.
// The locale is explicit because `undefined` would use the runtime's default locale,
// which on the server is the Worker's, not the visitor's.
export function formatPrice({ amount, currency, locale }: { amount: number; currency: string; locale: Locale }): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}
