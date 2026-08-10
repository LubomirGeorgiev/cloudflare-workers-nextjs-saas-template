"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useSelectedLayoutSegment } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { capitalize } from "@/utils/text";
import { useTranslations } from "next-intl";

// Known route segments that have a dedicated Settings.Nav translation label.
const SEGMENT_TITLE_KEYS: Record<string, "security" | "sessions" | "apiMcp"> = {
  security: "security",
  sessions: "sessions",
  "api-mcp": "apiMcp",
};

export function SettingsBreadcrumbs() {
  const segment = useSelectedLayoutSegment();
  const t = useTranslations("Client.Settings.Nav");

  let pageTitle: string;
  if (!segment) {
    pageTitle = t("overview");
  } else if (SEGMENT_TITLE_KEYS[segment]) {
    pageTitle = t(SEGMENT_TITLE_KEYS[segment]);
  } else {
    // Fallback for any custom segment added downstream
    pageTitle = capitalize(segment.replace(/-/g, ' '));
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          {/* `render` swaps the default bare `<a>` for the localized `Link`, so this is a soft
              navigation instead of a full document load. */}
          <BreadcrumbLink render={<Link href="/settings" />}>{t("settings")}</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator className="hidden md:block" />
        <BreadcrumbItem>
          <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
