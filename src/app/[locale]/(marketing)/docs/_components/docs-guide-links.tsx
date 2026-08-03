"use client";

import { usePathname as useUnlocalizedPathname } from "next/navigation";
import {
  Bot,
  Braces,
  CircleAlert,
  FileJson,
  FileText,
  FolderTree,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DOCS_ROUTE_SECTIONS,
  type DocsRouteDescriptor,
  type DocsRouteId,
} from "@/constants/docs-routes";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { getDocsNavPaddingLeft } from "./docs-nav-indent";

// Static chrome entries: these guides are real app routes rather than CMS documents, so they
// cannot come from the navigation tree. One renderer for the desktop sidebar and the mobile sheet.

const DOCS_ROUTE_ICONS: Record<DocsRouteId, LucideIcon> = {
  llmsTxt: FileText,
  openApiDocument: FileJson,
  apiReference: Braces,
  apiErrors: CircleAlert,
  authGuide: KeyRound,
  mcpGuide: Bot,
};

const LINK_CLASS =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/70";
/** Routes sit one level under their section heading, mirroring a page under a CMS group node. */
const SECTION_DEPTH = 0;
const ROUTE_DEPTH = SECTION_DEPTH + 1;

function DocsRouteLink({
  route,
  label,
  isActive,
  onNavigate,
}: {
  route: DocsRouteDescriptor;
  label: string;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const Icon = DOCS_ROUTE_ICONS[route.id];
  const className = cn(LINK_CLASS, isActive && "bg-accent font-medium text-accent-foreground");
  const style = { paddingLeft: getDocsNavPaddingLeft(route.parentId ? ROUTE_DEPTH + 1 : ROUTE_DEPTH) };
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </>
  );

  // Plain <a>, not the i18n Link: a machine endpoint like llms.txt is a route handler served at a
  // single non-localized URL, so it must not gain a locale prefix.
  if (!route.isLocalized) {
    return (
      <a
        href={route.pathname}
        onClick={onNavigate}
        data-active={isActive}
        className={className}
        style={style}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={route.pathname}
      onClick={onNavigate}
      data-active={isActive}
      className={className}
      style={style}
    >
      {content}
    </Link>
  );
}

export function DocsRouteLinks({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("Client.Docs.Navigation");
  const localizedPathname = usePathname();
  const unlocalizedPathname = useUnlocalizedPathname();

  return (
    <>
      {DOCS_ROUTE_SECTIONS.map((section) => (
        <div key={section.id}>
          <div
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground/80"
            style={{ paddingLeft: getDocsNavPaddingLeft(SECTION_DEPTH) }}
          >
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
            {/* next-intl cannot type-check a key built at runtime; the catalog is the contract. */}
            <span className="truncate">{t(section.labelKey as Parameters<typeof t>[0])}</span>
          </div>

          {section.groups.map((group) =>
            group.map((route) => (
              <DocsRouteLink
                key={route.id}
                route={route}
                label={t(route.labelKey as Parameters<typeof t>[0])}
                isActive={
                  (route.isLocalized ? localizedPathname : unlocalizedPathname) === route.pathname
                }
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      ))}
    </>
  );
}
