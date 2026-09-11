"use server";

import { actionClient } from "@/lib/safe-action";

import { buildCustomIconKey, parseUploadedSvgIcon } from "@/lib/cms/cms-icon-rules";
import { searchIcons } from "@/lib/cms/cms-icons";
import { saveCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { translateText } from "@/lib/cms/translate-entry";
import { requireAdmin } from "@/utils/auth";
import { parseCmsCustomIconSchema, searchCmsIconsSchema } from "@/schemas/cms-icons.schema";
import { saveCmsNavigationTreeSchema, translateNavTitleSchema } from "@/schemas/cms-navigation.schema";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";
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

// Icons matching what the admin typed, grouped by set, each with the sanitized SVG body the picker
// renders inline. The admin browser never calls the icon service, so the picker needs no CSP change.
export const searchCmsIconsAction = actionClient
  .inputSchema(searchCmsIconsSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const groups = await withUserRateLimit(
      () => searchIcons({ query: input.query }),
      RATE_LIMITS.CMS_ICON_PICKER,
    );

    return { groups };
  });

// Turns an uploaded SVG into the body the picker previews and the key the tree will store. Writes
// nothing: the document goes back to the client, which sends it again with the save so the server
// parses it a second time and stays the only writer of `iconBody`.
export const parseCmsCustomIconAction = actionClient
  .inputSchema(parseCmsCustomIconSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const icon = await withUserRateLimit(
      async () => parseUploadedSvgIcon(input.svg),
      RATE_LIMITS.CMS_ICON_PICKER,
    );

    // `svg` is the trimmed document this action parsed, not the file the browser read, so the
    // save re-parses the same bytes and cannot reach a different body than the preview showed.
    return {
      key: buildCustomIconKey({ label: input.label, markup: icon.markup }),
      icon,
      svg: input.svg,
    };
  });
