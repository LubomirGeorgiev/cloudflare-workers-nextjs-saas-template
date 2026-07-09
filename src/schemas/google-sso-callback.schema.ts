import { requiredString, v, validationKey } from "@/lib/validation";

export const googleSSOCallbackSchema = v.object({
  code: requiredString(validationKey("authorizationCodeRequired")),
  state: requiredString(validationKey("stateParameterRequired")),
});
