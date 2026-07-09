"use server";

import { actionClient } from "@/lib/safe-action";
import { cmsNavigationKeys } from "@/../cms.config";

import { saveCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { translateText } from "@/lib/cms/translate-entry";
import { requireAdmin } from "@/utils/auth";
import {
  cmsNavigationNodeTypeTuple,
} from "@/types/cms-navigation";
import { requiredString, v } from "@/lib/validation";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES, type Locale } from "@/i18n/config";

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

export const saveCmsNavigationTreeAction = actionClient
  .inputSchema(v.object({
    navigationKey: v.picklist(cmsNavigationKeys),
    items: v.array(cmsNavigationFlatNodeSchema),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    return saveCmsNavigationTree({
      navigationKey: input.navigationKey,
      items: input.items,
    });
  });

// AI-translates a single nav title into every enabled non-source locale, returning
// a { locale: text } map for the admin manager to fill in. Falls back to the source
// text per locale on any failure (aiTranslated:false lets the UI warn).
export const translateNavTitleAction = actionClient
  .inputSchema(v.object({
    title: requiredString("Title is required"),
    sourceLocale: v.optional(v.picklist(LOCALES), DEFAULT_LOCALE),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const targetLocales = ENABLED_LOCALES.filter((locale) => locale !== input.sourceLocale);

    // Each target locale is an independent AI round-trip, so translate them
    // concurrently. targetLocales is bounded by the enabled-locale count.
    const results = await Promise.all(
      targetLocales.map(async (targetLocale) => ({
        targetLocale,
        result: await translateText({
          text: input.title,
          sourceLocale: input.sourceLocale,
          targetLocale,
        }),
      }))
    );

    const translations: Partial<Record<Locale, string>> = {};
    let aiTranslated = false;
    for (const { targetLocale, result } of results) {
      translations[targetLocale] = result.text;
      if (result.translated) {
        aiTranslated = true;
      }
    }

    return { translations, aiTranslated };
  });
