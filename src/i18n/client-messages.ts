import "server-only";

import { getMessages } from "next-intl/server";

// The root `NextIntlClientProvider` serializes whatever it receives into every RSC
// payload, so forward only `Client.*` to keep server-only strings out of the browser.
// The `client-translations-under-client-namespace` oxlint rule keeps that subset complete.
export async function getClientMessages() {
  const messages = await getMessages();
  return { Client: messages.Client };
}
