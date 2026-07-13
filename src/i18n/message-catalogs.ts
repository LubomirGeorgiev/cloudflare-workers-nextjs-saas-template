import type { Locale } from "./config";
import enMessages from "./messages/en.json";
import esMessages from "./messages/es.json";

// String arrays are valid leaves (accessed via t.raw, e.g. plan feature lists); the
// fallback merge treats them like strings — replaced wholesale, never merged per-item.
export interface MessageTree {
  [key: string]: string | string[] | MessageTree;
}

export const MESSAGE_CATALOGS = {
  en: enMessages,
  es: esMessages,
} satisfies Record<Locale, MessageTree>;
