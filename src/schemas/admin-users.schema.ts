import { DEFAULT_ADMIN_TABLE_PAGE_SIZE, MAX_ADMIN_TABLE_PAGE_SIZE } from "@/constants";
import { requiredString, v } from "@/lib/validation";

export const getUserDataSchema = v.object({
  userId: requiredString("User ID is required"),
});

export const getUsersSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  pageSize: v.optional(
    v.pipe(v.number(), v.minValue(1), v.maxValue(MAX_ADMIN_TABLE_PAGE_SIZE)),
    DEFAULT_ADMIN_TABLE_PAGE_SIZE,
  ),
  emailFilter: v.optional(v.string()),
});
