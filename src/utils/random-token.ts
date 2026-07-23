import { encodeHexLowerCase } from "@oslojs/encoding";

const RANDOM_ID_BYTES = 18;

export function createBase64UrlToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function createRandomId(): string {
  return createBase64UrlToken(RANDOM_ID_BYTES);
}

export function createHexId(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return encodeHexLowerCase(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  return encodeHexLowerCase(new Uint8Array(hashBuffer));
}
