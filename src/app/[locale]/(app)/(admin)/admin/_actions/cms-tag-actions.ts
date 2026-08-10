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
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

// A tag mutation can change the admin list and every served locale's public tag pages (localized names live
// on /blog/tags and /blog/tags/[slug]). Public pages are locale-prefixed "as-needed": the default locale is
// unprefixed, others prefixed. With i18n disabled this collapses to the unprefixed paths only.
function revalidateCmsTagPaths(slug?: string) {
  revalidatePath("/admin/cms/tags");

  for (const locale of ENABLED_LOCALES) {
    const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
    revalidatePath(`${prefix}/blog/tags`);
    if (slug) {
      revalidatePath(`${prefix}/blog/tags/${slug}`);
    }
  }
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

    revalidateCmsTagPaths(newTag.slug);

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

    revalidateCmsTagPaths(updatedTag.slug);

    return updatedTag;
  });

export const deleteCmsTagAction = actionClient
  .inputSchema(cmsTagIdSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const deletedTag = await deleteCmsTag(input.id);

    revalidateCmsTagPaths(deletedTag?.slug);

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

    revalidateCmsTagPaths(newTag.slug);

    return newTag;
  });
