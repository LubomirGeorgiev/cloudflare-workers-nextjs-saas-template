// The Worker copies trusted `request.cf` values into these headers before vinext runs.
// Downstream server code reads them through `next/headers`; inbound client values are ignored.
export const __INTERNAL_CF_CONTEXT_FIELDS = [
  { key: "city", header: "__INTERNAL_CF_IPCITY" },
  { key: "continent", header: "__INTERNAL_CF_IPCONTINENT" },
  { key: "country", header: "__INTERNAL_CF_IPCOUNTRY" },
  { key: "asOrganization", header: "__INTERNAL_CF_AS_ORGANIZATION" },
  { key: "asn", header: "__INTERNAL_CF_ASN" },
  { key: "colo", header: "__INTERNAL_CF_COLO" },
  { key: 'region', header: '__INTERNAL_CF_REGION' },
  { key: 'postalCode', header: '__INTERNAL_CF_POSTAL_CODE' },
  { key: 'latitude', header: '__INTERNAL_CF_LATITUDE' },
  { key: 'longitude', header: '__INTERNAL_CF_LONGITUDE' },
  { key: 'timezone', header: '__INTERNAL_CF_TIMEZONE' },
  { key: 'isEUCountry', header: '__INTERNAL_CF_IS_EU_COUNTRY', valueKind: 'boolean' },
] as const satisfies ReadonlyArray<{
  key: keyof IncomingRequestCfProperties;
  header: string;
  /** How to interpret the forwarded header. Omit for string (default). */
  valueKind?: 'string' | 'boolean';
}>;

// oxlint-disable-next-line project/no-unused-module-exports -- Utility modules intentionally expose shared app/tooling contracts.
export type CfContextKey = (typeof __INTERNAL_CF_CONTEXT_FIELDS)[number]["key"];

// Geo values carry non-ASCII characters ("São Francisco de Assis"). workerd forwards them as UTF-8
// bytes but warns on every request, so percent-encode on write and decode on read.
export function encodeCfHeaderValue(value: string): string {
  return encodeURIComponent(value);
}

export function decodeCfHeaderValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export type CloudflareRequestContext = {
  [Field in (typeof __INTERNAL_CF_CONTEXT_FIELDS)[number] as Field["key"]]?: Field extends { valueKind: "boolean" }
    ? boolean
    : string;
};
