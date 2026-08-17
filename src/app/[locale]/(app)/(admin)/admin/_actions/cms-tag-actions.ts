"use server";

import { revalidatePath } from "next/cache";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import {
  getCmsTags,
  createCmsTag,
  updateCmsTag,
  deleteCmsTag,
  createCmsTagTranslation,
} from "@/lib/cms/tags";
import {
  cmsTagIdSchema,
  createCmsTagActionSchema,
  createCmsTagTranslationActionSchema,
  updateCmsTagActionSchema,
} from "@/schemas/cms-tag.schema";
import { ENABLED_LOCALES } from "@/i18n/config";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

const CMS_TAGS_PAGE_PATH = "/blog/tags";

/** The unprefixed public tag pages a tag mutation changes; both consumers below fan out over locales. */
function cmsTagPagePaths(slug?: string): string[] {
  return slug ? [CMS_TAGS_PAGE_PATH, `${CMS_TAGS_PAGE_PATH}/${slug}`] : [CMS_TAGS_PAGE_PATH];
}

// A tag mutation can change the admin list and every served locale's public tag pages (localized names live
// on /blog/tags and /blog/tags/[slug]). Public pages are locale-prefixed "as-needed": the default locale is
// unprefixed, others prefixed. With i18n disabled this collapses to the unprefixed paths only.
async function revalidateCmsTagPaths(slug?: string): Promise<void> {
  revalidatePath("/admin/cms/tags");

  const pathnames = cmsTagPagePaths(slug);

  for (const locale of ENABLED_LOCALES) {
    for (const pathname of pathnames) {
      revalidatePath(localizedPagePathname({ locale, pathname }));
    }
  }

  // `revalidatePath` reaches only the App Router cache. The converted `.md` twins of these pages
  // live in KV, so without this they serve the pre-mutation body until their TTL expires.
  await purgeMarkdownPageCache({ pathnames });
}

export const listCmsTagsAction = actionClient
  .action(async () => {
    await requireAdmin();
    const tags = await getCmsTags();
    return tags;
  });

export const createCmsTagAction = actionClient
  .inputSchema(createCmsTagActionSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ActionError("FORBIDDEN", "Not authorized");
    }

    const newTag = await createCmsTag({
      name: input.name,
      slug: input.slug,
      description: input.description,
      color: input.color,
      createdBy: session.userId,
    });

    await revalidateCmsTagPaths(newTag.slug);

    return newTag;
  });

export const updateCmsTagAction = actionClient
  .inputSchema(updateCmsTagActionSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const updatedTag = await updateCmsTag({
      id: input.id,
      name: input.name,
      slug: input.slug,
      description: input.description,
      color: input.color,
    });

    if (!updatedTag) {
      throw new ActionError("NOT_FOUND", "Tag not found");
    }

    await revalidateCmsTagPaths(updatedTag.slug);

    return updatedTag;
  });

export const deleteCmsTagAction = actionClient
  .inputSchema(cmsTagIdSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const deletedTag = await deleteCmsTag(input.id);

    await revalidateCmsTagPaths(deletedTag?.slug);

    return { success: true };
  });

export const createTagTranslationAction = actionClient
  .inputSchema(createCmsTagTranslationActionSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ActionError("FORBIDDEN", "Not authorized");
    }

    const newTag = await createCmsTagTranslation({
      slug: input.slug,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      createdBy: session.userId,
      autoTranslate: input.autoTranslate,
    });

    await revalidateCmsTagPaths(newTag.slug);

    return newTag;
  });
