"use client";

import { IntlProvider } from "use-intl/react";

import { DEFAULT_TIME_ZONE, type Locale } from "./config";
import type { MessageTree } from "./message-catalogs";

interface AppIntlProviderProps {
  locale: Locale;
  messages: MessageTree;
  children: React.ReactNode;
}

// The one client-side translation provider. It pins the time zone so a formatted date reads the
// same on the server and in the browser that hydrates it. `now` is deliberately absent: a default
// would make every render dynamic.
export function AppIntlProvider({ locale, messages, children }: AppIntlProviderProps) {
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={DEFAULT_TIME_ZONE}>
      {children}
    </IntlProvider>
  );
}
