/**
 * Where the brand mark is served from, as opposed to how it is drawn. The URL carries the generated
 * version stamp, because mail proxies and crawlers cache by URL and a regenerated mark needs a new
 * one. Split from `logo.ts` because `pnpm logo:generate` loads that module to write the stamp: an
 * import back the other way would make a deleted stamp impossible to regenerate.
 */

import { SITE_URL } from "@/constants";
import { EMAIL_LOGO, SITE_LOGO } from "@/constants/logo";
import { LOGO_VERSION } from "@/constants/logo-version";

// The one absolute link to the mark handed to anything outside the app — an email client, a search
// crawler. Hosted, not inline: Gmail, Outlook and Yahoo each strip a data URI, and a `cid:`
// reference needs the multipart/related body the send path does not build.
export const SITE_LOGO_URL = `${SITE_URL}${SITE_LOGO.pathname}?v=${LOGO_VERSION}`;

// One object per `<img>`, so a template cannot take the source from here and the box from the
// geometry module and let the two drift apart.
export const EMAIL_LOGO_IMAGE = {
  url: SITE_LOGO_URL,
  width: EMAIL_LOGO.width,
  height: EMAIL_LOGO.height,
} as const;
