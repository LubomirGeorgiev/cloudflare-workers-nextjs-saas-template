// The Worker copies trusted `request.cf` values into these headers before vinext runs.
// Downstream server code reads them through `next/headers`; inbound client values are ignored.
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

// oxlint-disable-next-line project/no-unused-module-exports -- Utility modules intentionally expose shared app/tooling contracts.
export type CfContextKey = (typeof CF_CONTEXT_FIELDS)[number]["key"];

export type CloudflareRequestContext = {
  [Field in (typeof CF_CONTEXT_FIELDS)[number] as Field["key"]]?: Field extends { valueKind: "boolean" }
    ? boolean
    : string;
};
