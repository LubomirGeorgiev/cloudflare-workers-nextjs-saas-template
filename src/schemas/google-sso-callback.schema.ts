import { v, validationKey } from "@/lib/validation";
import { tokenField } from "@/schemas/fields";

export const googleSSOCallbackSchema = v.object({
  code: tokenField(validationKey("authorizationCodeRequired")),
  state: tokenField(validationKey("stateParameterRequired")),
});
