export const __INTERNAL_TRUSTED_CLIENT_IP_HEADER = "__INTERNAL_TRUSTED_CLIENT_IP";

export const __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP = [
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "cf-pseudo-ipv4",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
] as const;
