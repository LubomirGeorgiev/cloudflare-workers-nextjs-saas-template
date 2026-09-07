"use server";

import { revalidatePath } from "next/cache";

import { runAdminSystemAction } from "@/lib/admin/system-actions";
import { actionClient } from "@/lib/safe-action";
import { type SystemAction, systemActionSchema } from "@/schemas/system-action.schema";
import { requireAdmin } from "@/utils/auth";

// The KV and CDN purges touch no CMS read, so only these three actions invalidate the CMS page.
const CMS_AFFECTING_ACTION_TYPES: SystemAction["type"][] = [
  "rebuild-search-index",
  "clear-search-cache",
  "clear-cms-cache",
];

// No `confirm` field here: the panel's AlertDialog is this caller's confirmation, while the REST
// purges take one in the body because a machine caller has no dialog.
export const runSystemAction = actionClient
  .inputSchema(systemActionSchema)
  .action(async ({ parsedInput }) => {
    await requireAdmin();

    const result = await runAdminSystemAction(parsedInput);

    revalidatePath("/admin/system");

    if (CMS_AFFECTING_ACTION_TYPES.includes(parsedInput.type)) {
      revalidatePath("/admin/cms");
    }

    return {
      success: true,
      message: result.message,
    };
  });
