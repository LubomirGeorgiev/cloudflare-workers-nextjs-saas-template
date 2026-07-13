// Formats a Stripe smallest-unit amount (e.g. cents) in the viewer's locale. Shared by
// billing UI on both server and client; whole amounts drop the fraction digits.
export function formatPrice({ amount, currency }: { amount: number; currency: string }): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}
