import { beforeAll, test } from "vitest";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import {
  clickAppRole,
  expectAppLabelValue,
  expectAppPathname,
  expectAppRoleText,
  expectAppText,
  expectAppToast,
  expectNoAppToast,
  navigateAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";
import { SEEDED_BLOG_ENTRY, SEEDED_DOCS_ENTRY } from "./seed-fixtures";

const password = SEEDED_USER_PASSWORD;

let adminEmail: string;

async function createAdminUser(): Promise<void> {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  adminEmail = `cms-admin-${uniqueId}@example.com`;

  await createVerifiedUserInLocalD1({
    email: adminEmail,
    firstName: "CMS",
    idPrefix: "usr_cms_admin",
    lastName: "Admin",
    role: "admin",
  });
}

beforeAll(async () => {
  await createAdminUser();
});

test("lets admins browse the CMS dashboard and seeded collection lists", async () => {
  await signInWithPassword({
    email: adminEmail,
    password,
    redirectPath: "/admin/cms",
  });

  await expectAppPathname("/admin/cms");
  await expectAppText("Content Management", { exact: true });
  await expectAppText("Blogs", { exact: true });
  await expectAppText("Docs", { exact: true });
  await expectAppText("Docs Navigation", { exact: true });
  await expectAppText("Media Library", { exact: true });
  await expectAppText("Tags", { exact: true });

  await navigateAppFrame("/admin/cms/blog");

  await expectAppPathname("/admin/cms/blog");
  await expectAppText("Blogs", { exact: true });
  await expectAppText("Create Blog", { exact: true });
  await expectAppText("Filter by status:", { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.title, { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.slug, { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.authorName, { exact: true });

  await navigateAppFrame("/admin/cms/docs");

  await expectAppPathname("/admin/cms/docs");
  await expectAppText("Docs", { exact: true });
  await expectAppText("Create Doc", { exact: true });
  await expectAppText("Navigation", { exact: true });
  await expectAppText("Introduction", { exact: true });
  await expectAppText("Authentication Setup", { exact: true });
});

test("loads seeded CMS edit forms with existing entry metadata", async () => {
  await signInWithPassword({
    email: adminEmail,
    password,
    redirectPath: `/admin/cms/blog/${SEEDED_BLOG_ENTRY.id}`,
  });

  await expectAppPathname(`/admin/cms/blog/${SEEDED_BLOG_ENTRY.id}`);
  await expectAppText("Edit Blog", { exact: true });
  await expectAppText(SEEDED_BLOG_ENTRY.title, { exact: true });
  await expectAppText("Basic Information", { exact: true });
  await expectAppText("Custom Fields", { exact: true });
  await expectAppText("Content", { exact: true });
  await expectAppRoleText({
    role: "combobox",
    name: "Status",
    text: "Published",
    exact: true,
  });
  await expectAppText("Tags", { exact: true });
  await expectAppText("Entry Information", { exact: true });
  await expectAppText("Version history");
  await expectAppLabelValue({
    label: "Title *",
    value: SEEDED_BLOG_ENTRY.title,
  });
  await expectAppLabelValue({
    label: "URL Slug *",
    value: SEEDED_BLOG_ENTRY.slug,
  });

  await navigateAppFrame(`/admin/cms/docs/${SEEDED_DOCS_ENTRY.id}`);

  await expectAppPathname(`/admin/cms/docs/${SEEDED_DOCS_ENTRY.id}`);
  await expectAppText("Edit Doc", { exact: true });
  await expectAppRoleText({
    role: "combobox",
    name: "Status",
    text: "Published",
    exact: true,
  });
  await expectAppText("Entry Information", { exact: true });
  await expectAppLabelValue({
    label: "Title *",
    value: "Introduction",
  });
  await expectAppLabelValue({
    label: "Entry Slug *",
    value: "introduction",
  });
});

// The Toaster sits top-right, over the Save button, so a save toast there took the next click.
test("replaces the save toast in place, so the Save button takes a second click", async () => {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entryId = `cms_ent_e2e_save_${uniqueId}`;

  // A draft blog row: no public page, no navigation, and the oldest date, so no list shows it first.
  await queryLocalD1({
    sql: `
      insert into cms_entry (
        id, collection, title, content, fields, slug, seoDescription, status, createdBy,
        createdAt, updatedAt, updateCounter
      )
      values (
        ${sqlStringLiteral(entryId)},
        ${sqlStringLiteral(BLOG_COLLECTION_SLUG)},
        'Save toast fixture',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Body"}]}]}',
        '{}',
        ${sqlStringLiteral(`save-toast-${uniqueId}`)},
        'Save toast fixture',
        'draft',
        (select id from user where email = ${sqlStringLiteral(adminEmail)}),
        1,
        1,
        0
      );
    `,
  });

  try {
    await signInWithPassword({
      email: adminEmail,
      password,
      redirectPath: `/admin/cms/${BLOG_COLLECTION_SLUG}/${entryId}`,
    });

    await clickAppRole("button", "Save Changes");
    await expectAppToast("Entry updated successfully");
    await expectNoAppToast("Updating entry...");

    await clickAppRole("button", "Save Changes");
    await expectAppToast("Entry updated successfully");
  } finally {
    await queryLocalD1({ sql: `delete from cms_entry where id = ${sqlStringLiteral(entryId)};` });
  }
});

test("loads CMS tags, media, and docs navigation admin screens", async () => {
  await signInWithPassword({
    email: adminEmail,
    password,
    redirectPath: "/admin/cms/tags",
  });

  await expectAppPathname("/admin/cms/tags");
  await expectAppText("Tags", { exact: true });
  await expectAppText("Create Tag", { exact: true });
  await expectAppText("Next.js", { exact: true });
  await expectAppText("Cloudflare", { exact: true });

  await navigateAppFrame("/admin/cms/media");

  await expectAppPathname("/admin/cms/media");
  await expectAppText("Media Library", { exact: true });
  await expectAppText("Uploaded Media", { exact: true });
  await expectAppText("No media files", { exact: true });

  await navigateAppFrame("/admin/cms/navigation/docs");

  await expectAppPathname("/admin/cms/navigation/docs");
  await expectAppText("Docs Navigation", { exact: true });
  await expectAppText("Docs Navigation Tree", { exact: true });
  await expectAppText("Add Group", { exact: true });
  await expectAppText("Add Page", { exact: true });
  await expectAppText("Save", { exact: true });
  await expectAppText("Getting Started", { exact: true });
  // The editor selects the first node on load, so the detail panel renders its tabs.
  await expectAppText("Style", { exact: true });
});

test("lets admins open the navigation icon picker", async () => {
  await signInWithPassword({
    email: adminEmail,
    password,
    redirectPath: "/admin/cms/navigation/docs",
  });

  await expectAppPathname("/admin/cms/navigation/docs");

  // The editor selects the first node on load, so the panel header already offers the icon button.
  await expectAppText("Style", { exact: true });

  await clickAppRole("button", "Change icon", { exact: true });

  // Copy from inside the lazy chunk, so reaching it proves the dynamic import resolved.
  await expectAppText("Choose Icon", { exact: true });
  await expectAppText("Type a word to search every icon set.", { exact: true });
});
