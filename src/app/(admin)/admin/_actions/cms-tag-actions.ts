"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import {
  getCmsTags,
  createCmsTag,
  updateCmsTag,
  deleteCmsTag,
} from "@/lib/cms/cms-repository";

export const listCmsTagsAction = actionClient
  .action(async () => {
    await requireAdmin();
    const tags = await getCmsTags();
    return tags;
  });

export const createCmsTagAction = actionClient
  .inputSchema(
    z.object({
      name: z.string().min(1, "Name is required"),
      slug: z.string().min(1, "Slug is required"),
      description: z.string().optional(),
      color: z.string().optional(),
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
    z.object({
      id: z.string(),
      name: z.string().min(1, "Name is required").optional(),
      slug: z.string().min(1, "Slug is required").optional(),
      description: z.string().optional(),
      color: z.string().optional(),
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
  .inputSchema(z.object({ id: z.string() }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsTag(input.id);

    return { success: true };
  });
