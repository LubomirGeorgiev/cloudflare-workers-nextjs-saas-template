import { encodeValidationMessage, minString, v, validationKey } from "@/lib/validation";

export const resetPasswordSchema = v.pipe(
  v.object({
    token: v.string(),
    password: minString(8, encodeValidationMessage("passwordMinLength", { min: 8 })),
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
