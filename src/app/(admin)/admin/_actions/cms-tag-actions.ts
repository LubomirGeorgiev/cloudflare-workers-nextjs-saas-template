"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import {
  getCmsTags,
  createCmsTag,
  updateCmsTag,
  deleteCmsTag,
} from "@/lib/cms/cms-repository";
import { requiredString, v } from "@/lib/validation";

export const listCmsTagsAction = actionClient
  .action(async () => {
    await requireAdmin();
    const tags = await getCmsTags();
    return tags;
  });

export const createCmsTagAction = actionClient
  .inputSchema(
    v.object({
      name: requiredString("Name is required"),
      slug: requiredString("Slug is required"),
      description: v.optional(v.string()),
      color: v.optional(v.string()),
    })
  )
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

    return newTag;
  });

export const updateCmsTagAction = actionClient
  .inputSchema(
    v.object({
      id: v.string(),
      name: v.optional(requiredString("Name is required")),
      slug: v.optional(requiredString("Slug is required")),
      description: v.optional(v.string()),
      color: v.optional(v.string()),
    })
  )
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

    return updatedTag;
  });

export const deleteCmsTagAction = actionClient
  .inputSchema(v.object({ id: v.string() }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsTag(input.id);

    return { success: true };
  });
