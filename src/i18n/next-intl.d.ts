import type messages from "./messages/en.json";
import type { Locale } from "./config";

// Augment next-intl with our concrete locale union and message shape so that
// `useTranslations`/`getTranslations` namespaces and keys are type-checked and
// autocompleted against messages/en.json (the source-of-truth catalog).
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
