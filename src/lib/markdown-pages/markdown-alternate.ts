import { SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";

import { buildMarkdownPagePath, localizedPagePathname } from "./page-paths";
import { resolveMdRequestTarget } from "./resolve-target";

/**
 * The media type of every `.md` twin, for both the `Link` header and the metadata alternate.
 * Re-exported from `@/constants`, which owns it so the Worker entry can read it without pulling
 * this module onto its startup graph.
 */
export { MARKDOWN_CONTENT_TYPE } from "@/constants";

export interface MarkdownAlternate {
  path: string;
  url: string;
}

interface MarkdownAlternateParams {
  /** Locale-agnostic when `locale` is given, already locale-prefixed when it is not. */
  pathname: string;
  locale?: Locale;
}

// The one Markdown-alternate rule: localize, build the `.md` path, and keep it only when the
// Worker would actually serve it. Kept free of request scope — a Worker handler with no App Router
// request and a `generateMetadata` call both go through here.
export function markdownAlternateFor({
  pathname,
  locale,
}: MarkdownAlternateParams): MarkdownAlternate | null {
  const localizedPathname = locale ? localizedPagePathname({ locale, pathname }) : pathname;
  const path = buildMarkdownPagePath({ pathname: localizedPathname });

  if (!resolveMdRequestTarget(path)) {
    return null;
  }

  return { path, url: `${SITE_URL}${path}` };
}
