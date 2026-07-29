import { v } from "@/lib/validation";

export const cmsEntryVersionListSchema = v.object({
  entryId: v.string(),
});

export const cmsEntryVersionRefSchema = v.object({
  entryId: v.string(),
  versionId: v.string(),
});
