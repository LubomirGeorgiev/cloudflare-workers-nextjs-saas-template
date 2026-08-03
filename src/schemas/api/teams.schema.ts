import { v } from "@/lib/validation";
import { nullableIsoDateSchema } from "@/schemas/api/common.schema";
import { renameTeamSchema } from "@/schemas/team.schema";

// The rename body drops `teamId`: the path already carries it, and accepting it twice would
// let a request address two different teams.
export const updateTeamSchema = v.omit(renameTeamSchema, ["teamId"]);

export const teamSchema = v.object({
  id: v.string(),
  name: v.string(),
  slug: v.string(),
  description: v.nullable(v.string()),
  avatarUrl: v.nullable(v.string()),
  role: v.object({
    id: v.string(),
    name: v.string(),
  }),
});

export const teamListSchema = v.array(teamSchema);

export const teamBillingSchema = v.object({
  planId: v.string(),
  planName: v.string(),
  status: v.nullable(v.string()),
  interval: v.nullable(v.string()),
  // Active add-on units keyed by add-on id; empty on the free plan.
  addons: v.record(v.string(), v.number()),
  planExpiresAt: nullableIsoDateSchema,
  cancelAtPeriodEnd: v.boolean(),
  needsPaymentAction: v.boolean(),
});
