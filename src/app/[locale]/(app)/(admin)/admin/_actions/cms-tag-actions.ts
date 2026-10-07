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
import { withCmsCachePurgeReport } from "@/lib/cms/cms-cache-purge-report";
import { CMS_TAGS_PAGE_PATH } from "@/lib/blog-routing";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

/** The unprefixed public tag pages a tag mutation changes; the caller fans out over locales. */
function cmsTagPagePaths(slug?: string): string[] {
  return slug ? [CMS_TAGS_PAGE_PATH, `${CMS_TAGS_PAGE_PATH}/${slug}`] : [CMS_TAGS_PAGE_PATH];
}

// A tag mutation can change the admin list and every served locale's public tag pages (localized names live
// on /blog/tags and /blog/tags/[slug]). Public pages are locale-prefixed "as-needed": the default locale is
// unprefixed, others prefixed. With i18n disabled this collapses to the unprefixed paths only.
// The `.md` twins are not purged here: `invalidateCmsTagGroupCaches` does it before its edge purge.
function revalidateCmsTagPaths(slug?: string): void {
  revalidatePath("/admin/cms/tags");

  const pathnames = cmsTagPagePaths(slug);

  for (const locale of ENABLED_LOCALES) {
    for (const pathname of pathnames) {
      revalidatePath(localizedPagePathname({ locale, pathname }));
    }
  }
}

export const listCmsTagsAction = actionClient
  .metadata({ actionName: "listCmsTagsAction" })
  .action(async () => {
    await requireAdmin();
    const tags = await getCmsTags();
    return tags;
  });

export const createCmsTagAction = actionClient
  .metadata({ actionName: "createCmsTagAction" })
  .inputSchema(createCmsTagActionSchema)
  .action(({ parsedInput: input }) => withCmsCachePurgeReport(async () => {
    const session = await requireAdmin();

    const newTag = await createCmsTag({
      name: input.name,
      slug: input.slug,
      description: input.description,
      color: input.color,
      createdBy: session.userId,
    });

    revalidateCmsTagPaths(newTag.slug);

    return newTag;
  }));

export const updateCmsTagAction = actionClient
  .metadata({ actionName: "updateCmsTagAction" })
  .inputSchema(updateCmsTagActionSchema)
  .action(({ parsedInput: input }) => withCmsCachePurgeReport(async () => {
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

    revalidateCmsTagPaths(updatedTag.slug);

    return updatedTag;
  }));

export const deleteCmsTagAction = actionClient
  .metadata({ actionName: "deleteCmsTagAction" })
  .inputSchema(cmsTagIdSchema)
  .action(({ parsedInput: input }) => withCmsCachePurgeReport(async () => {
    await requireAdmin();

    const deletedTag = await deleteCmsTag(input.id);

    revalidateCmsTagPaths(deletedTag?.slug);

    return { success: true };
  }));

export const createTagTranslationAction = actionClient
  .metadata({ actionName: "createTagTranslationAction" })
  .inputSchema(createCmsTagTranslationActionSchema)
  .action(({ parsedInput: input }) => withCmsCachePurgeReport(async () => {
    const session = await requireAdmin();

    const newTag = await createCmsTagTranslation({
      slug: input.slug,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      createdBy: session.userId,
      autoTranslate: input.autoTranslate,
    });

    revalidateCmsTagPaths(newTag.slug);

    return newTag;
  }));
