import { SITE_NAME } from "@/constants";

/** Filename slug of the site root, because a bare site-name file tells the reader nothing. */
const ROOT_FILENAME_SLUG = "index";

// One owner for the download filename: the page branch and the CMS route both answer `?download`,
// and two copies of the rule would let their filenames drift apart.
export function markdownDownloadDisposition({ subject }: { subject: string }): string {
  const siteSlug = SITE_NAME.toLowerCase().replace(/\s+/g, "-");
  const subjectSlug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || ROOT_FILENAME_SLUG;

  return `attachment; filename="${siteSlug}-${subjectSlug}.md"`;
}
