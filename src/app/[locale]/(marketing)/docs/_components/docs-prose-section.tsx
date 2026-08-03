import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { DocsOnThisPageNav } from "@/app/[locale]/(marketing)/docs/_components/docs-on-this-page-nav";
import type { TableOfContentsNode } from "@/lib/cms/table-of-contents-tree";

// Shared body layout for the docs pages that are real app routes (API reference, authentication,
// MCP) rather than CMS documents, so they read like one set of pages.

/** Heading level of every prose section, so the TOC nests like the CMS docs one. */
const SECTION_HEADING_LEVEL = 2;

interface DocsProseSectionSpec {
  /** Stable, untranslated anchor: it is a public deep link and the TOC target. */
  id: string;
  title: string;
  body?: string;
  children?: ReactNode;
}

function DocsProseSection({ id, title, body, children }: DocsProseSectionSpec) {
  return (
    <section className="space-y-2">
      {/* scroll-mt-24 matches the TOC's active-heading offset. */}
      <h2 id={id} className="scroll-mt-24 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {body ? <p className="text-sm text-muted-foreground">{body}</p> : null}
      {children}
    </section>
  );
}

export async function DocsProsePage({
  title,
  description,
  headerAside,
  sections,
}: {
  title: string;
  description: string;
  headerAside?: ReactNode;
  sections: DocsProseSectionSpec[];
}) {
  const t = await getTranslations("Client.Docs.Page");
  // Built from the same list that renders the sections, so the TOC can never drift from the page.
  const tableOfContents: TableOfContentsNode[] = sections.map((section) => ({
    id: section.id,
    level: SECTION_HEADING_LEVEL,
    text: section.title,
    children: [],
  }));

  return (
    <div className="px-4 py-10 lg:px-8">
      <header className="mb-8 space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-2xl text-muted-foreground">{description}</p>
        {headerAside}
      </header>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 max-w-3xl space-y-8">
          {sections.map((section) => (
            <DocsProseSection key={section.id} {...section} />
          ))}
        </div>

        {tableOfContents.length > 0 ? (
          <aside className="hidden xl:block">
            <div className="sticky top-10 max-h-[calc(100vh-5rem)]">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {t("onThisPage")}
              </p>
              <DocsOnThisPageNav nodes={tableOfContents} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
