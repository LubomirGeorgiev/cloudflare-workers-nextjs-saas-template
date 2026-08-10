import "server-only";

import { getMessages } from "next-intl/server";

import type { Locale } from "./config";

// The root `NextIntlClientProvider` serializes whatever it receives into every RSC
// payload, so forward only `Client.*` to keep server-only strings out of the browser.
// The `client-translations-under-client-namespace` oxlint rule keeps that subset complete.
//
// `locale` is a required argument on purpose: if it is omitted, next-intl works it out by reading
// request headers, and that stops the page being cached. Callers in the signed-in app pass the
// locale they resolved from the user's cookie.
export async function getClientMessages(locale: Locale) {
  const messages = await getMessages({ locale });
  return { Client: messages.Client };
}
