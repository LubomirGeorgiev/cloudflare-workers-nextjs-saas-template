import { randomUUID } from "node:crypto";
import type { JSONContent } from "@tiptap/core";
import { expect, test } from "vitest";
import { CMS_IMAGES_API_ROUTE, CMS_IMAGES_BASE_PATH } from "@/constants";
import { CMS_IMAGE_QUALITY, IMAGE_DEVICE_SIZES } from "@/constants/images";
import { ALERT_BLOCK_NODE_NAME } from "@/constants/cms-content-nodes";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { clickAppRole, expectAppToast, fetchAppPath, fillAppLabel } from "./app-frame";
import { createVerifiedUserInLocalD1, SEEDED_USER_PASSWORD, signInWithPassword } from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";

async function withCmsEntry({ content, run }: {
  content: JSONContent;
  run: (entry: { id: string; slug: string; email: string }) => Promise<void>;
}) {
  const id = randomUUID();
  const slug = `html-${id}`;
  const email = `${id}@example.com`;
  await createVerifiedUserInLocalD1({ email, role: "admin" });
  try {
    await queryLocalD1({ sql: `
      insert into cms_entry (id, createdAt, updatedAt, collection, title, content, fields, slug, status, createdBy, locale)
      select ${sqlStringLiteral(id)}, 1, 1, 'blog', 'CMS HTML check', ${sqlStringLiteral(JSON.stringify(content))}, '{}',
        ${sqlStringLiteral(slug)}, 'published', id, ${sqlStringLiteral(DEFAULT_LOCALE)} from user where email = ${sqlStringLiteral(email)};
    ` });
    await run({ id, slug, email });
  } finally {
    await queryLocalD1({ sql: `delete from cms_entry where id = ${sqlStringLiteral(id)};` });
    await queryLocalD1({ sql: `delete from user where email = ${sqlStringLiteral(email)};` });
  }
}

test("renders CMS images, alerts, and code on cold and cached requests", async () => {
  const src = `${CMS_IMAGES_API_ROUTE}/${CMS_IMAGES_BASE_PATH}/blog/${randomUUID()}.png`;
  await withCmsEntry({
    content: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "CMS HTML check" }] },
      { type: "paragraph", content: [{ type: "text", text: "A cached description." }] },
      { type: "image", attrs: { src, alt: "CMS image", width: 800, height: 400 } },
      { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const ready = true;" }] },
      { type: ALERT_BLOCK_NODE_NAME, attrs: { title: "Alert check", body: "First line\nSecond line", variant: "warning" } },
    ] },
    run: async ({ slug }) => {
      for (let request = 0; request < 2; request++) {
        const response = await fetchAppPath(`/blog/${slug}`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('id="cms-html-check"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
        expect(html).toContain('srcset="');
        expect(html).toContain(encodeURIComponent(src));
        expect(html).toContain(`q=${CMS_IMAGE_QUALITY}`);
        expect(html).toContain(`${IMAGE_DEVICE_SIZES[0]}w`);
        expect(html).toContain("hljs-keyword");
        expect(html).toContain('data-type="alert-block"');
        expect(html).toContain('data-variant="warning"');
        expect(html).toContain("First line\nSecond line");
        expect(html).not.toContain("contenteditable");
      }
    },
  });
});

test("edits the shared alert view and refreshes the cached public output", async () => {
  await withCmsEntry({
    content: { type: "doc", content: [
      { type: ALERT_BLOCK_NODE_NAME, attrs: { title: "Original title", body: "Original body", variant: "info" } },
    ] },
    run: async ({ id, slug, email }) => {
      expect(await (await fetchAppPath(`/blog/${slug}`)).text()).toContain("Original body");
      await signInWithPassword({ email, password: SEEDED_USER_PASSWORD, redirectPath: `/admin/cms/blog/${id}` });
      await clickAppRole("checkbox", "Auto-translate with AI", { exact: true });
      await fillAppLabel({ label: "Alert title", value: "Updated <title>" });
      await fillAppLabel({ label: "Alert body", value: "Updated first line\nUpdated second line" });
      await clickAppRole("button", "Save Changes", { exact: true });
      await expectAppToast("Entry updated successfully");
      const response = await fetchAppPath(`/blog/${slug}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Updated &lt;title&gt;");
      expect(html).toContain("Updated first line\nUpdated second line");
      expect(html).not.toContain("Original body");
    },
  });
});
