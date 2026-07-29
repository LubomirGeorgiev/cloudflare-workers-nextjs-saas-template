import { cmsNavigationKeys } from "@/../cms.config";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { requiredString, v } from "@/lib/validation";
import { cmsNavigationNodeTypeTuple } from "@/types/cms-navigation";

const cmsNavigationFlatNodeSchema = v.object({
  id: requiredString(),
  parentId: v.nullable(v.string()),
  nodeType: v.picklist(cmsNavigationNodeTypeTuple),
  title: requiredString(),
  // Per-locale title overrides; repository sanitizes/drops default-locale + empties.
  titleTranslations: v.optional(
    v.nullable(v.record(v.picklist(LOCALES), v.string()))
  ),
  entryId: v.nullable(v.string()),
  slugSegment: v.nullable(v.string()),
  sortOrder: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const saveCmsNavigationTreeSchema = v.object({
  navigationKey: v.picklist(cmsNavigationKeys),
  items: v.array(cmsNavigationFlatNodeSchema),
});

export const translateNavTitleSchema = v.object({
  title: requiredString("Title is required"),
  sourceLocale: v.optional(v.picklist(LOCALES), DEFAULT_LOCALE),
});
