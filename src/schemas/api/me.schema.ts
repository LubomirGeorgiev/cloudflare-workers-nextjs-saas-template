import { isoDateSchema, nullableIsoDateSchema } from "@/schemas/api/common.schema";
import { v } from "@/lib/validation";
import { sessionIdField } from "@/schemas/fields";

export const meSchema = v.object({
  id: v.string(),
  // Nullable in D1: an account can exist without an email address.
  email: v.nullable(v.string()),
  firstName: v.nullable(v.string()),
  lastName: v.nullable(v.string()),
  role: v.string(),
  avatar: v.nullable(v.string()),
  preferredLocale: v.nullable(v.string()),
  emailVerified: nullableIsoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const sessionSchema = v.object({
  id: v.string(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  isCurrentSession: v.boolean(),
  authenticationType: v.nullable(v.string()),
  country: v.nullable(v.string()),
  city: v.nullable(v.string()),
  browser: v.nullable(v.string()),
  os: v.nullable(v.string()),
  deviceType: v.nullable(v.string()),
});

export const sessionListSchema = v.array(sessionSchema);

export const sessionIdParamSchema = v.object({
  sessionId: sessionIdField(),
});
