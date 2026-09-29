import { maxString, v } from "@/lib/validation";

// The longest export name today is under 50 characters; the bound is the rule every string follows.
const ACTION_NAME_MAX_LENGTH = 100;

// Code sets this with `.metadata(...)` on each action, never a caller. `safe-action.ts` puts the
// name on the action's trace span, and `safe-action-names.test.ts` pins it to the export name.
export const actionMetadataSchema = v.object({
  actionName: maxString(ACTION_NAME_MAX_LENGTH),
});
