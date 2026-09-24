import type { Locale } from "./config";
import type messages from "./messages/en.json";

// Augment use-intl with our concrete locale union and message shape so that
// `useTranslations`/`getTranslations` namespaces and keys are type-checked and
// autocompleted against messages/en.json (the source-of-truth catalog).
declare module "use-intl/core" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
