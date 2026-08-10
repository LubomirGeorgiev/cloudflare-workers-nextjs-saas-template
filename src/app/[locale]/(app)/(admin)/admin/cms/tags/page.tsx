import { Metadata } from "next";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";

import { Link } from "@/i18n/navigation";
import { getCmsTags, getCmsTagLocaleCoverage } from "@/lib/cms/tags";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft, Plus, Tag } from "lucide-react";
import { ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { LocaleCoverageBadges } from "../_components/locale-coverage-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Tags | Admin",
  description: "Manage content tags and categories",
};

export default async function TagsPage() {
  await requireAdminOrRedirectHome();

  const tags = await getCmsTags();

  // Only surface translation coverage when the site actually serves >1 locale.
  const showTranslations = ENABLED_LOCALES.length > 1;
  const coverage = showTranslations ? await getCmsTagLocaleCoverage() : new Map();
  const columnCount = showTranslations ? 7 : 6;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/cms"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
              <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tags</h1>
            <p className="text-muted-foreground mt-2">
              Manage content tags and categories
            </p>
          </div>
        </div>
        <Link href="/admin/cms/tags/new" className={buttonVariants()}>
            <Plus className="h-4 w-4 mr-2" />
            Create Tag
        </Link>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Used in</TableHead>
              {showTranslations && <TableHead>Translations</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">
                  No tags found. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/cms/tags/${tag.id}`} className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      {tag.name}
                    </Link>
                  </TableCell>
                  <TableCell>{tag.slug}</TableCell>
                  <TableCell>
                    {tag.color ? (
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-muted-foreground text-sm">{tag.color}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {tag.description || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{tag.entryCount}</span>
                  </TableCell>
                  {showTranslations && (
                    <TableCell>
                      <LocaleCoverageBadges
                        translatedLocales={coverage.get(tag.slug) ?? new Set<Locale>()}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Link
                      href={`/admin/cms/tags/${tag.id}`}
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
