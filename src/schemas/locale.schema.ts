import { ENABLED_LOCALES } from "@/i18n/config";
import { v } from "@/lib/validation";

// The served set, not the full catalog: a stored preference for a locale that is not routed
// would send the next sign-in to a URL that does not exist.
export const setUserLocaleSchema = v.object({
  locale: v.picklist(ENABLED_LOCALES),
});
