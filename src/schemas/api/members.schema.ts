import { v } from "@/lib/validation";
import { nullableIsoDateSchema } from "@/schemas/api/common.schema";

export const teamMemberSchema = v.object({
  membershipId: v.string(),
  userId: v.string(),
  // Nullable in D1: an account can exist without an email address.
  email: v.nullable(v.string()),
  firstName: v.nullable(v.string()),
  lastName: v.nullable(v.string()),
  avatar: v.nullable(v.string()),
  roleId: v.string(),
  // Null for system roles: their display name is a localized label, not stored data.
  roleName: v.nullable(v.string()),
  isSystemRole: v.boolean(),
  isActive: v.boolean(),
  joinedAt: nullableIsoDateSchema,
});

export const teamMemberListSchema = v.array(teamMemberSchema);
