import { cmsNavigationKeys } from "@/../cms.config";
import {
  CMS_MAX_NAVIGATION_NODES,
  CMS_NAVIGATION_TITLE_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from "@/constants";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { maxString, trimmedString, v } from "@/lib/validation";
import { idField } from "@/schemas/fields";
import { cmsNavigationNodeTypeTuple } from "@/types/cms-navigation";

const navigationTitleField = trimmedString({ min: 1, max: CMS_NAVIGATION_TITLE_MAX_LENGTH });

const cmsNavigationFlatNodeSchema = v.object({
  id: idField(),
  parentId: v.nullable(idField()),
  nodeType: v.picklist(cmsNavigationNodeTypeTuple),
  title: navigationTitleField,
  // Per-locale title overrides; repository sanitizes/drops default-locale + empties.
  titleTranslations: v.optional(
    v.nullable(v.record(v.picklist(LOCALES), maxString(CMS_NAVIGATION_TITLE_MAX_LENGTH)))
  ),
  entryId: v.nullable(idField()),
  slugSegment: v.nullable(maxString(SLUG_MAX_LENGTH)),
  sortOrder: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const saveCmsNavigationTreeSchema = v.object({
  navigationKey: v.picklist(cmsNavigationKeys),
  // The whole tree arrives in one payload, so the node count is bounded like every other input.
  items: v.pipe(v.array(cmsNavigationFlatNodeSchema), v.maxLength(CMS_MAX_NAVIGATION_NODES)),
});

export const translateNavTitleSchema = v.object({
  title: trimmedString({
    min: 1,
    max: CMS_NAVIGATION_TITLE_MAX_LENGTH,
    minMessage: "Title is required",
  }),
  sourceLocale: v.optional(v.picklist(LOCALES), DEFAULT_LOCALE),
});
