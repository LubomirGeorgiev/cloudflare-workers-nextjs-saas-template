"use server";

import { z } from "zod";
import { actionClient } from "@/lib/safe-action";
import { cmsNavigationKeys } from "@/../cms.config";

import { saveCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { requireAdmin } from "@/utils/auth";
import {
  cmsNavigationNodeTypeTuple,
} from "@/types/cms-navigation";

const cmsNavigationFlatNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  nodeType: z.enum(cmsNavigationNodeTypeTuple),
  title: z.string().min(1),
  entryId: z.string().nullable(),
  slugSegment: z.string().nullable(),
  sortOrder: z.number().int().min(0),
});

export const saveCmsNavigationTreeAction = actionClient
  .inputSchema(z.object({
    navigationKey: z.enum(cmsNavigationKeys),
    items: z.array(cmsNavigationFlatNodeSchema),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    return saveCmsNavigationTree({
      navigationKey: input.navigationKey,
      items: input.items,
    });
  });
