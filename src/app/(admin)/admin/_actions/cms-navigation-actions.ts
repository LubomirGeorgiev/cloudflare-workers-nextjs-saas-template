"use server";

import { actionClient } from "@/lib/safe-action";

import { saveCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { translateText } from "@/lib/cms/translate-entry";
import { requireAdmin } from "@/utils/auth";
import { saveCmsNavigationTreeSchema, translateNavTitleSchema } from "@/schemas/cms-navigation.schema";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";

export const saveCmsNavigationTreeAction = actionClient
  .inputSchema(saveCmsNavigationTreeSchema)
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
  .inputSchema(translateNavTitleSchema)
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
