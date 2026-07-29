import { ENABLED_LOCALES, LOCALES } from "@/i18n/config";
import { v } from "@/lib/validation";

// Shared locale/auto-translate trio for the CMS "create translation" actions
// (entries and tags), so their locale rules can never drift apart.
export const cmsTranslationTargetFields = {
  // Source can be any catalog locale (the row already exists); only the target
  // is restricted to served locales below.
  sourceLocale: v.picklist(LOCALES),
  // Only served locales are valid targets — with i18n disabled this rejects
  // creating orphan translations that would never be routed to.
  targetLocale: v.picklist(ENABLED_LOCALES),
  // Auto-translate the seeded copy by default; pass false for a verbatim copy.
  autoTranslate: v.optional(v.boolean(), true),
};
