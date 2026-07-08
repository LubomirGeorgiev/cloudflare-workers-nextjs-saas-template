// FNV-1a: fast, dependency-free, non-cryptographic string hash. Use for change
// detection, cache keys, and bucketing — anywhere a short, stable fingerprint of a
// string is enough. NOT for security (no collision resistance); use crypto.subtle
// (see password-hasher.ts / auth.ts) when integrity or secrecy matters.
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 coerces to unsigned; base36 keeps the output short.
  return (hash >>> 0).toString(36);
}
