/**
 * Shared mapping between `request.cf` properties and the HTTP headers that
 * carry them into Next.js/vinext server code. The worker entry copies each
 * value from `request.cf` onto the request (never trusting inbound client
 * headers) before invoking vinext. Downstream code reads them via `next/headers`.
 */
export const CF_CONTEXT_FIELDS = [
  { key: "city", header: "cf-ipcity" },
  { key: "continent", header: "cf-ipcontinent" },
  { key: "country", header: "cf-ipcountry" },
  { key: "asOrganization", header: "x-cf-as-organization" },
  { key: "asn", header: "x-cf-asn" },
  { key: "colo", header: "x-cf-colo" },
  { key: 'region', header: 'x-cf-region' },
  { key: 'postalCode', header: 'x-cf-postal-code' },
  { key: 'latitude', header: 'x-cf-latitude' },
  { key: 'longitude', header: 'x-cf-longitude' },
  { key: 'timezone', header: 'x-cf-timezone' },
  { key: 'isEUCountry', header: 'x-cf-is-eu-country', valueKind: 'boolean' },
] as const satisfies ReadonlyArray<{
  key: keyof IncomingRequestCfProperties;
  header: string;
  /** How to interpret the forwarded header. Omit for string (default). */
  valueKind?: 'string' | 'boolean';
}>;

export type CfContextKey = (typeof CF_CONTEXT_FIELDS)[number]["key"];

export type CloudflareRequestContext = {
  [Field in (typeof CF_CONTEXT_FIELDS)[number] as Field["key"]]?: Field extends { valueKind: "boolean" }
    ? boolean
    : string;
};
