import { v, validationKey } from "@/lib/validation";
import { newPasswordSchema } from "./password.schema";

export const resetPasswordSchema = v.pipe(
  v.object({
    token: v.string(),
    password: newPasswordSchema,
    confirmPassword: v.string(),
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
