"use server";

import { actionClient } from "@/lib/safe-action";
import { cmsNavigationKeys } from "@/../cms.config";

import { saveCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { requireAdmin } from "@/utils/auth";
import {
  cmsNavigationNodeTypeTuple,
} from "@/types/cms-navigation";
import { requiredString, v } from "@/lib/validation";

const cmsNavigationFlatNodeSchema = v.object({
  id: requiredString(),
  parentId: v.nullable(v.string()),
  nodeType: v.picklist(cmsNavigationNodeTypeTuple),
  title: requiredString(),
  entryId: v.nullable(v.string()),
  slugSegment: v.nullable(v.string()),
  sortOrder: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const saveCmsNavigationTreeAction = actionClient
  .inputSchema(v.object({
    navigationKey: v.picklist(cmsNavigationKeys),
    items: v.array(cmsNavigationFlatNodeSchema),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    return saveCmsNavigationTree({
      navigationKey: input.navigationKey,
      items: input.items,
    });
  });
