"use client";

import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const router = useRouter();
  const { locale, pathname, query, asPath } = router;

  const changeLanguage = (newLocale: string) => {
    router.push({ pathname, query }, asPath, { locale: newLocale });
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={locale === "en" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => changeLanguage("en")}
      >
        English
      </Button>
      <Button
        variant={locale === "ja" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => changeLanguage("ja")}
      >
        日本語
      </Button>
    </div>
  );
}
