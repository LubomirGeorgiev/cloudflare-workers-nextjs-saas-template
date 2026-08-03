import { v } from "@/lib/validation";
import { idField } from "@/schemas/fields";

export const cmsEntryVersionListSchema = v.object({
  entryId: idField(),
});

export const cmsEntryVersionRefSchema = v.object({
  entryId: idField(),
  versionId: idField(),
});
