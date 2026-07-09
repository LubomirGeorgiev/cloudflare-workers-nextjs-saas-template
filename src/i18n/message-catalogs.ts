import type { Locale } from "./config";
import enMessages from "./messages/en.json";
import esMessages from "./messages/es.json";

export interface MessageTree {
  [key: string]: string | MessageTree;
}

export const MESSAGE_CATALOGS = {
  en: enMessages,
  es: esMessages,
} satisfies Record<Locale, MessageTree>;
