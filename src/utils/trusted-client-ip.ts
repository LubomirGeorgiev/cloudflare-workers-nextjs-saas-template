export const TRUSTED_CLIENT_IP_HEADER = "x-vinext-trusted-client-ip";

export const CLIENT_IP_HEADERS_TO_STRIP = [
  TRUSTED_CLIENT_IP_HEADER,
  "cf-connecting-ip",
  "cf-connecting-ipv6",
  "cf-pseudo-ipv4",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "x-client-ip",
  "x-cluster-client-ip",
] as const;
