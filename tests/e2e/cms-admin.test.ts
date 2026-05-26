import { beforeAll, test } from "vitest";
import {
  expectAppLabelValue,
  expectAppPathname,
  expectAppText,
  navigateAppFrame,
} from "./app-frame";
import { signInWithPassword } from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";

const password = "password";

let adminEmail: string;

async function createAdminUser(): Promise<string> {
  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `cms-admin-${uniqueId}@example.com`;
  const passwordHash = await queryLocalD1({
    sql: `select passwordHash from user where email = 'test@test.com' limit 1;`,
  });
  const now = Math.floor(Date.now() / 1_000);

  await queryLocalD1({
    sql: `
      insert into user (
        id,
        createdAt,
        updatedAt,
        updateCounter,
        firstName,
        lastName,
        email,
        passwordHash,
        role,
        emailVerified,
        signUpIpAddress,
        googleAccountId,
        avatar,
        currentCredits,
        lastCreditRefreshAt
      )
      values (
        ${sqlStringLiteral(`usr_cms_admin_${uniqueId}`)},
        ${now},
        ${now},
        0,
        'CMS',
        'Admin',
        ${sqlStringLiteral(email)},
        ${sqlStringLiteral(passwordHash)},
        'admin',
        ${now},
        '127.0.0.1',
        null,
        null,
        0,
        ${now}
      );
    `,
  });

  return email;
}

beforeAll(async () => {
  adminEmail = await createAdminUser();
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

  await navigateAppFrame("/admin/cms/blog", { waitForHydration: true });

  await expectAppPathname("/admin/cms/blog");
  await expectAppText("Blogs", { exact: true });
  await expectAppText("Create Blog", { exact: true });
  await expectAppText("Filter by status:", { exact: true });
  await expectAppText("Getting Started with Next.js 15", { exact: true });
  await expectAppText("getting-started-with-nextjs-15", { exact: true });
  await expectAppText("Test Testov", { exact: true });

  await navigateAppFrame("/admin/cms/docs", { waitForHydration: true });

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
    redirectPath: "/admin/cms/blog/cms_ent_test001",
  });

  await expectAppPathname("/admin/cms/blog/cms_ent_test001");
  await expectAppText("Edit Blog", { exact: true });
  await expectAppText("Getting Started with Next.js 15", { exact: true });
  await expectAppText("Basic Information", { exact: true });
  await expectAppText("Custom Fields", { exact: true });
  await expectAppText("Content", { exact: true });
  await expectAppText("Publishing", { exact: true });
  await expectAppText("Tags", { exact: true });
  await expectAppText("Entry Information", { exact: true });
  await expectAppText("Version history");
  await expectAppLabelValue({
    label: "Title *",
    value: "Getting Started with Next.js 15",
  });
  await expectAppLabelValue({
    label: "URL Slug *",
    value: "getting-started-with-nextjs-15",
  });

  await navigateAppFrame("/admin/cms/docs/cms_ent_docs001", {
    waitForHydration: true,
  });

  await expectAppPathname("/admin/cms/docs/cms_ent_docs001");
  await expectAppText("Edit Doc", { exact: true });
  await expectAppText("Publishing", { exact: true });
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

  await navigateAppFrame("/admin/cms/media", { waitForHydration: true });

  await expectAppPathname("/admin/cms/media");
  await expectAppText("Media Library", { exact: true });
  await expectAppText("Uploaded Media", { exact: true });
  await expectAppText("No media files", { exact: true });

  await navigateAppFrame("/admin/cms/navigation/docs", {
    waitForHydration: true,
  });

  await expectAppPathname("/admin/cms/navigation/docs");
  await expectAppText("Docs Navigation", { exact: true });
  await expectAppText("Docs Navigation Tree", { exact: true });
  await expectAppText("Add Group", { exact: true });
  await expectAppText("Add Page", { exact: true });
  await expectAppText("Save", { exact: true });
  await expectAppText("Getting Started", { exact: true });
  await expectAppText("Introduction", { exact: true });
  await expectAppText("Selected Item Details", { exact: true });
});
