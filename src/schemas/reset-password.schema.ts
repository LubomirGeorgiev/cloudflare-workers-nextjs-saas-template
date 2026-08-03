import { maxString, v, validationKey } from "@/lib/validation";
import { tokenField } from "@/schemas/fields";
import { newPasswordSchema, PASSWORD_MAX_LENGTH } from "./password.schema";

export const resetPasswordSchema = v.pipe(
  v.object({
    token: tokenField(),
    password: newPasswordSchema,
    // Only ever compared with `password`; bounded so the comparison cannot be handed a huge string.
    confirmPassword: maxString(PASSWORD_MAX_LENGTH),
  }),
  v.forward(
    v.partialCheck(
      [["password"], ["confirmPassword"]],
      (data) => data.password === data.confirmPassword,
      validationKey("passwordsDoNotMatch")
    ),
    ["confirmPassword"]
  )
);

export type ResetPasswordSchema = v.InferOutput<typeof resetPasswordSchema>;
