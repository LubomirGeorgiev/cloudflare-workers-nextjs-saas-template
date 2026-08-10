import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";

import { noImplicitLocaleTranslationsRule } from "./no-implicit-locale-translations.js";

// The rule resolves hook callees through the scope chain, so the cases below run on real source
// through oxlint's own tester. Hand-built AST nodes cannot carry the scope information it reads.
RuleTester.describe = describe;
RuleTester.it = it;

// Inside a watched segment, so the rule does not bail out on the filename.
const WATCHED_FILE = "/repo/src/components/site-footer.tsx";

// Every runtime export of "next-intl/server" except `setRequestLocale`. `getRequestConfig` is left
// out: it only ever appears in `src/i18n/request.ts`, outside the watched segments.
const LOCALE_RESOLVING_SERVER_EXPORTS = [
  "getTranslations",
  "getFormatter",
  "getNow",
  "getTimeZone",
  "getMessages",
  "getLocale",
];

const ruleTester = new RuleTester({
  languageOptions: { sourceType: "module" },
});

function valid(code: string, filename: string = WATCHED_FILE) {
  return { code, filename };
}

function invalid(code: string, errors: RuleTester.Error[], filename: string = WATCHED_FILE) {
  return { code, filename, errors };
}

function serverImportError(exportName: string): RuleTester.Error {
  return { message: new RegExp(`\`${exportName}\` from "next-intl/server"`) };
}

function hookError(calleeName: string): RuleTester.Error {
  return { message: new RegExp(`\`${calleeName}\` resolves the locale from \`headers\\(\\)\``) };
}

ruleTester.run("no-implicit-locale-translations", noImplicitLocaleTranslationsRule, {
  valid: [
    valid(`import { setRequestLocale } from "next-intl/server";\nsetRequestLocale("en");`),
    valid(`import type { getTranslations } from "next-intl/server";`),
    valid(`import { type getTranslations } from "next-intl/server";`),

    // The same names from another module are somebody else's helpers.
    valid(
      `import { getTranslator } from "@/i18n/translator";\nimport { getLocale } from "./local-helpers";`
    ),

    valid(`import { getTranslations } from "next-intl/server";`, "/repo/src/lib/teams/teams.ts"),
    valid(
      `import { getLocale } from "next-intl/server";`,
      "/repo/src/app/[locale]/(app)/(dashboard)/layout.tsx"
    ),
    valid(
      `import { getLocale } from "next-intl/server";`,
      "/repo/src/app/[locale]/(auth)/sso/google/route.ts"
    ),

    // The safe half of "next-intl" stays callable on the server.
    valid(
      `import { hasLocale, NextIntlClientProvider } from "next-intl";\nexport const ok = hasLocale(["en"], "en");\nexport const Provider = NextIntlClientProvider;`
    ),

    valid(`import type { useTranslations } from "next-intl";`),
    valid(`import { type useTranslations } from "next-intl";\nexport const t = null;`),

    valid(
      `"use client";\nimport { useTranslations } from "next-intl";\nexport function Footer() {\n  const t = useTranslations("Footer");\n  return t("title");\n}`
    ),

    valid(
      `import { useTranslations } from "next-intl";\nexport function Footer() {\n  const t = useTranslations("Footer");\n  return t("title");\n}`,
      "/repo/src/lib/teams/teams.ts"
    ),

    // A local helper that happens to share the name is not the hook.
    valid(`function useTranslations() {}\nexport const t = useTranslations();`),

    // The import exists, but an inner declaration shadows it, so the call never reaches the hook.
    valid(
      `import { useTranslations } from "next-intl";\nexport function Footer() {\n  function useTranslations() {\n    return (key: string) => key;\n  }\n  return useTranslations()("title");\n}`
    ),
    valid(
      `import { useLocale } from "next-intl";\nexport function Row({ useLocale }: { useLocale: () => string }) {\n  return useLocale();\n}`
    ),
    valid(
      `import * as intl from "next-intl";\nexport function Row(intl: { useLocale: () => string }) {\n  return intl.useLocale();\n}`
    ),
  ],
  invalid: [
    ...LOCALE_RESOLVING_SERVER_EXPORTS.map((exportName) =>
      invalid(`import { ${exportName} } from "next-intl/server";`, [
        { message: new RegExp(`\`${exportName}\` from "next-intl/server"[\\s\\S]*@/i18n/translator`) },
      ])
    ),

    invalid(
      `import { getLocale, setRequestLocale, getMessages } from "next-intl/server";`,
      [serverImportError("getLocale"), serverImportError("getMessages")]
    ),

    // The import is what matters, not the local name.
    invalid(`import { getTranslations as loadTranslations } from "next-intl/server";`, [
      serverImportError("getTranslations"),
    ]),

    invalid(`import * as serverIntl from "next-intl/server";`, [
      { message: /import \* as serverIntl from "next-intl\/server"/ },
    ]),

    // "next-intl/server" is server-only, so `"use client"` is no excuse for importing it.
    invalid(`"use client";\nimport { getLocale } from "next-intl/server";`, [
      serverImportError("getLocale"),
    ]),

    ...["useTranslations", "useLocale", "useFormatter", "useNow"].map((hookName) =>
      invalid(`import { ${hookName} } from "next-intl";\nexport const value = ${hookName}();`, [
        hookError(hookName),
      ])
    ),

    invalid(
      `import { useTranslations as useIntl } from "next-intl";\nexport const t = useIntl();`,
      [hookError("useIntl")]
    ),

    // A namespace import reaches the hooks through a property, and `hasLocale` stays safe.
    invalid(
      `import * as intl from "next-intl";\nexport const locale = intl.useLocale();\nexport const ok = intl.hasLocale(["en"], "en");`,
      [hookError("intl.useLocale")]
    ),

    // The call the rule exists for: inside a component body, not at the top level.
    invalid(
      `import { useTranslations } from "next-intl";\nexport function Footer() {\n  const t = useTranslations("Footer");\n  return t("title");\n}`,
      [hookError("useTranslations")]
    ),

    // Nested deeper still, inside a callback inside a component.
    invalid(
      `import { useFormatter } from "next-intl";\nexport function List({ items }: { items: { date: Date }[] }) {\n  return items.map((item) => {\n    const format = useFormatter();\n    return format.dateTime(item.date);\n  });\n}`,
      [hookError("useFormatter")]
    ),

    invalid(
      `import * as intl from "next-intl";\nexport function Footer() {\n  return intl.useLocale();\n}`,
      [hookError("intl.useLocale")]
    ),

    // The shadow ends with its scope; the call after it reaches the import again.
    invalid(
      `import { useLocale } from "next-intl";\nexport function Shadowed() {\n  const useLocale = () => "en";\n  return useLocale();\n}\nexport function Plain() {\n  return useLocale();\n}`,
      [hookError("useLocale")]
    ),
  ],
});
