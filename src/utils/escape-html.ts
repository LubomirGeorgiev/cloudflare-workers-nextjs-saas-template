/**
 * Escapes text interpolated into a hand-built HTML string. Shared so the email templates and the
 * `pnpm email:preview` contact sheet cannot drift apart on which characters they escape.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
